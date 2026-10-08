output "app_url" {
  value = "https://${azurerm_container_app.agent.ingress[0].fqdn}"
}

output "whatsapp_webhook_url" {
  description = "Paste into the Twilio WhatsApp sender configuration."
  value       = "https://${azurerm_container_app.agent.ingress[0].fqdn}/whatsapp/webhook"
}

output "acr_login_server" {
  value = azurerm_container_registry.this.login_server
}

output "openai_endpoint" {
  value = azurerm_cognitive_account.openai.endpoint
}

output "log_analytics_workspace_id" {
  value = azurerm_log_analytics_workspace.this.workspace_id
}
