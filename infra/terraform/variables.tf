variable "subscription_id" {
  type        = string
  description = "Azure subscription to deploy into."
}

variable "prefix" {
  type        = string
  description = "Short lowercase prefix for resource names (3-10 letters/digits)."
  validation {
    condition     = can(regex("^[a-z0-9]{3,10}$", var.prefix))
    error_message = "prefix must be 3-10 lowercase letters or digits."
  }
}

variable "location" {
  type    = string
  default = "eastus2"
}

variable "openai_location" {
  type        = string
  description = "Region for Azure OpenAI. Model availability differs by region; check before applying."
  default     = "eastus2"
}

variable "openai_deployment_name" {
  type    = string
  default = "support-agent"
}

variable "openai_model_name" {
  type        = string
  description = "Any chat model with tool calling that your subscription can deploy in openai_location."
}

variable "openai_model_version" {
  type        = string
  description = "Model version string as listed in Azure AI Foundry for that model and region."
}

variable "openai_capacity_k_tpm" {
  type        = number
  description = "Deployment capacity in thousands of tokens per minute."
  default     = 10
}

variable "openai_api_version" {
  type        = string
  description = "Azure OpenAI data-plane API version the app calls."
}

variable "price_input_per_1m" {
  type        = number
  description = "USD per 1M input tokens for the chosen model, from the Azure pricing page. Used for cost logging only."
}

variable "price_output_per_1m" {
  type        = number
  description = "USD per 1M output tokens for the chosen model."
}

variable "image_tag" {
  type    = string
  default = "latest"
}

variable "min_replicas" {
  type        = number
  description = "0 lets the app scale to zero (cold starts); 1 keeps it warm."
  default     = 0
}

variable "max_replicas" {
  type    = number
  default = 3
}

variable "admin_api_key" {
  type        = string
  sensitive   = true
  description = "Key for the refund approval API. At least 16 characters."
  validation {
    condition     = length(var.admin_api_key) >= 16
    error_message = "admin_api_key must be at least 16 characters."
  }
}

variable "chat_api_key" {
  type        = string
  sensitive   = true
  description = "Key the calling backend sends on /v1/conversations."
}

variable "enable_whatsapp" {
  type        = bool
  default     = false
  description = "Wire the Twilio WhatsApp webhook. Needs twilio_auth_token."
}

variable "twilio_auth_token" {
  type        = string
  sensitive   = true
  default     = ""
  description = "Twilio auth token, used to verify webhook signatures. Only read when enable_whatsapp = true."
}

variable "monthly_budget_usd" {
  type    = number
  default = 20
}

variable "budget_start_date" {
  type        = string
  description = "First day of the current month, RFC3339, e.g. 2026-10-01T00:00:00Z."
}

variable "budget_alert_email" {
  type = string
}
