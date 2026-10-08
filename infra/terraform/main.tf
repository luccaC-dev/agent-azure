terraform {
  required_version = ">= 1.6"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }
}

provider "azurerm" {
  features {}
  subscription_id = var.subscription_id
}

locals {
  name = "${var.prefix}-agent"
  tags = { project = "agent-azure-demo", managed_by = "terraform" }
}

resource "azurerm_resource_group" "this" {
  name     = "rg-${local.name}"
  location = var.location
  tags     = local.tags
}

# --- Observability: container stdout (one JSON line per agent turn) lands in Log Analytics.
resource "azurerm_log_analytics_workspace" "this" {
  name                = "log-${local.name}"
  location            = azurerm_resource_group.this.location
  resource_group_name = azurerm_resource_group.this.name
  sku                 = "PerGB2018"
  retention_in_days   = 30
  tags                = local.tags
}

# --- Azure OpenAI with key auth disabled: the app can only get in with its managed identity.
resource "azurerm_cognitive_account" "openai" {
  name                  = "oai-${local.name}"
  location              = var.openai_location
  resource_group_name   = azurerm_resource_group.this.name
  kind                  = "OpenAI"
  sku_name              = "S0"
  custom_subdomain_name = "oai-${local.name}"
  local_auth_enabled    = false
  tags                  = local.tags
}

resource "azurerm_cognitive_deployment" "chat" {
  name                 = var.openai_deployment_name
  cognitive_account_id = azurerm_cognitive_account.openai.id

  model {
    format  = "OpenAI"
    name    = var.openai_model_name
    version = var.openai_model_version
  }

  sku {
    name     = "GlobalStandard"
    capacity = var.openai_capacity_k_tpm
  }
}

# --- Identity the container runs as. It can pull its image and call the model, nothing else.
resource "azurerm_user_assigned_identity" "app" {
  name                = "id-${local.name}"
  location            = azurerm_resource_group.this.location
  resource_group_name = azurerm_resource_group.this.name
  tags                = local.tags
}

resource "azurerm_container_registry" "this" {
  name                = replace("acr${local.name}", "-", "")
  location            = azurerm_resource_group.this.location
  resource_group_name = azurerm_resource_group.this.name
  sku                 = "Basic"
  admin_enabled       = false
  tags                = local.tags
}

resource "azurerm_role_assignment" "acr_pull" {
  scope                = azurerm_container_registry.this.id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_user_assigned_identity.app.principal_id
}

resource "azurerm_role_assignment" "openai_user" {
  scope                = azurerm_cognitive_account.openai.id
  role_definition_name = "Cognitive Services OpenAI User"
  principal_id         = azurerm_user_assigned_identity.app.principal_id
}

# --- Runtime
resource "azurerm_container_app_environment" "this" {
  name                       = "cae-${local.name}"
  location                   = azurerm_resource_group.this.location
  resource_group_name        = azurerm_resource_group.this.name
  log_analytics_workspace_id = azurerm_log_analytics_workspace.this.id
  tags                       = local.tags
}

resource "azurerm_container_app" "agent" {
  name                         = "ca-${local.name}"
  container_app_environment_id = azurerm_container_app_environment.this.id
  resource_group_name          = azurerm_resource_group.this.name
  revision_mode                = "Single"
  tags                         = local.tags

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.app.id]
  }

  registry {
    server   = azurerm_container_registry.this.login_server
    identity = azurerm_user_assigned_identity.app.id
  }

  secret {
    name  = "admin-api-key"
    value = var.admin_api_key
  }

  secret {
    name  = "chat-api-key"
    value = var.chat_api_key
  }

  dynamic "secret" {
    for_each = var.enable_whatsapp ? ["on"] : []
    content {
      name  = "twilio-auth-token"
      value = var.twilio_auth_token
    }
  }

  ingress {
    external_enabled = true
    target_port      = 3000
    transport        = "auto"
    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  template {
    min_replicas = var.min_replicas
    max_replicas = var.max_replicas

    container {
      name   = "agent"
      image  = "${azurerm_container_registry.this.login_server}/agent-azure:${var.image_tag}"
      cpu    = 0.5
      memory = "1Gi"

      env {
        name  = "LLM_PROVIDER"
        value = "azure"
      }
      env {
        name  = "AZURE_OPENAI_ENDPOINT"
        value = azurerm_cognitive_account.openai.endpoint
      }
      env {
        name  = "AZURE_OPENAI_DEPLOYMENT"
        value = azurerm_cognitive_deployment.chat.name
      }
      env {
        name  = "AZURE_OPENAI_API_VERSION"
        value = var.openai_api_version
      }
      # DefaultAzureCredential picks the user-assigned identity from this variable.
      env {
        name  = "AZURE_CLIENT_ID"
        value = azurerm_user_assigned_identity.app.client_id
      }
      env {
        name  = "PRICE_INPUT_PER_1M"
        value = tostring(var.price_input_per_1m)
      }
      env {
        name  = "PRICE_OUTPUT_PER_1M"
        value = tostring(var.price_output_per_1m)
      }
      env {
        name        = "ADMIN_API_KEY"
        secret_name = "admin-api-key"
      }
      env {
        name        = "CHAT_API_KEY"
        secret_name = "chat-api-key"
      }
      dynamic "env" {
        for_each = var.enable_whatsapp ? ["on"] : []
        content {
          name        = "TWILIO_AUTH_TOKEN"
          secret_name = "twilio-auth-token"
        }
      }

      liveness_probe {
        transport = "HTTP"
        port      = 3000
        path      = "/healthz"
      }
    }

    http_scale_rule {
      name                = "http"
      concurrent_requests = "20"
    }
  }

  depends_on = [azurerm_role_assignment.acr_pull, azurerm_role_assignment.openai_user]
}

# --- Cost guardrail: email when the resource group passes the monthly budget.
resource "azurerm_consumption_budget_resource_group" "this" {
  name              = "budget-${local.name}"
  resource_group_id = azurerm_resource_group.this.id
  amount            = var.monthly_budget_usd
  time_grain        = "Monthly"

  time_period {
    start_date = var.budget_start_date
  }

  notification {
    enabled        = true
    threshold      = 80
    operator       = "GreaterThan"
    contact_emails = [var.budget_alert_email]
  }
}
