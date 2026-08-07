all are api samples from meta 
--TEMPLATE:
    curl --request GET \
  --url 'https://graph.facebook.com/{Version}/{WABA-ID}/message_templates' \
  --header 'Authorization: Bearer <Token>' \
  --header 'Content-Type: application/json' \
  --data '{}'

res:
    {
  "templates_list": {
    "summary": "List of message templates",
    "value": {
      "data": [
        {
          "id": "1234567890123456",
          "name": "hello_world",
          "status": "APPROVED",
          "category": "UTILITY",
          "language": "en_US",
          "parameter_format": "NAMED",
          "message_send_ttl_seconds": 86400,
          "is_primary_device_delivery_only": false,
          "quality_score": {
            "score": "GREEN",
            "date": 1705312200
          },
          "source": "manual",
          "components": [
            {
              "type": "HEADER",
              "format": "TEXT",
              "text": "Hello {{1}}"
            },
            {
              "type": "BODY",
              "text": "Welcome to our service, {{1}}!"
            },
            {
              "type": "FOOTER",
              "text": "Reply STOP to unsubscribe"
            }
          ]
        },
        {
          "id": "2345678901234567",
          "name": "order_update",
          "status": "APPROVED",
          "category": "UTILITY",
          "sub_category": "ORDER_STATUS",
          "language": "en_US",
          "quality_score": {
            "score": "GREEN",
            "date": 1705312200
          },
          "source": "manual"
        }
      ],
      "paging": {
        "cursors": {
          "after": "QVFIUjJ5WjBpMGpJWXprYzVYaVhabW9PVks4ZD0"
        }
      }
    }
  }
}

POST:
curl --request POST \
  --url 'https://graph.facebook.com/{Version}/{WABA-ID}/message_templates' \
  --header 'Authorization: Bearer <Token>' \
  --header 'Content-Type: application/json' \
  --data '{
  "name": "seasonal_promotion",
  "language": "en",
  "category": "MARKETING",
  "components": [
    {
      "type": "HEADER",
      "format": "TEXT",
      "text": "Our {{1}} is on!",
      "example": {
        "header_text": [
          "Summer Sale"
        ]
      }
    },
    {
      "type": "BODY",
      "text": "Shop now through {{1}} and use code {{2}} to get {{3}} off.",
      "example": {
        "body_text": [
          [
            "25OFF",
            "25%"
          ]
        ]
      }
    },
    {
      "type": "FOOTER",
      "text": "Use the buttons below to manage your subscriptions"
    },
    {
      "type": "BUTTONS",
      "buttons": [
        {
          "type": "QUICK_REPLY",
          "text": "Unsubscribe from Promos"
        },
        {
          "type": "QUICK_REPLY",
          "text": "Unsubscribe from All"
        }
      ]
    }
  ]
}'

response :
{
  "marketing_template": {
    "summary": "Marketing template with quick reply buttons",
    "value": {
      "id": "1234567890123456",
      "status": "PENDING",
      "category": "MARKETING"
    }
  },
  "authentication_template": {
    "summary": "Authentication template response",
    "value": {
      "id": "2345678901234567",
      "status": "PENDING",
      "category": "AUTHENTICATION"
    }
  },
  "utility_template": {
    "summary": "Utility template response",
    "value": {
      "id": "3456789012345678",
      "status": "PENDING",
      "category": "UTILITY"
    }
  }
}

DELETE
curl --request DELETE \
  --url 'https://graph.facebook.com/{Version}/{WABA-ID}/message_templates' \
  --header 'Authorization: Bearer <Token>' \
  --header 'Content-Type: application/json' \
  --data '{}'

{
  "success": true
}

--SCHEDULE MESSAGES:
GET
curl --request GET \
  --url 'https://graph.facebook.com/{Version}/{WABA-ID}/schedules' \
  --header 'Authorization: Bearer <Token>' \
  --header 'Content-Type: application/json' \
  --data '{}'

response
{
  "schedules_list": {
    "summary": "Campaign schedules",
    "value": {
      "data": [
        {
          "id": "1234567890123456",
          "name": "Spring Sale Campaign",
          "description": "Weekly promotional campaign",
          "delivery_time": 1706097600,
          "status": "SCHEDULED"
        },
        {
          "id": "2345678901234567",
          "name": "Welcome Series",
          "description": "New customer welcome messages",
          "delivery_time": 1706011200,
          "status": "COMPLETED"
        }
      ],
      "paging": {
        "cursors": {
          "after": "MTAxNTExOTQ1MjAwNzI5NDE="
        }
      }
    }
  }
}

POST
curl --request POST \
  --url 'https://graph.facebook.com/{Version}/{WABA-ID}/schedules' \
  --header 'Authorization: Bearer <Token>' \
  --header 'Content-Type: application/json' \
  --data '{
  "hsm_id": "9876543210987654",
  "audience_id": "1111222233334444",
  "waba_cs_id": "5555666677778888",
  "description": "Weekly promotional campaign",
  "name": "Spring Sale Campaign",
  "delivery_time": 1706097600
}'

response
{
  "successful_creation": {
    "summary": "Schedule successfully created",
    "value": {
      "id": "1234567890123456"
    }
  }
}

--WHATSAPP BUSINESS MANAGMENT API
GET
curl --request GET \
  --url 'https://graph.facebook.com/{Version}/{WABA-ID}' \
  --header 'Authorization: Bearer <Token>' \
  --header 'Content-Type: application/json' \
  --data '{}'
response
{
  "verified_account": {
    "summary": "Verified WhatsApp Business Account with full details",
    "value": {
      "id": "1234567890123456",
      "name": "My Business WhatsApp Account",
      "timezone_id": "1",
      "message_template_namespace": "ba30dd89_2ebd_41e4_b805_f2c05ae04cc9",
      "account_review_status": "APPROVED",
      "business_verification_status": "VERIFIED",
      "country": "US",
      "ownership_type": "SELF",
      "primary_business_location": "US"
    }
  },
  "basic_account": {
    "summary": "Basic WhatsApp Business Account with minimal details",
    "value": {
      "id": "2345678901234567",
      "name": "Test Business Account",
      "timezone_id": "1",
      "account_review_status": "PENDING",
      "business_verification_status": "NOT_VERIFIED"
    }
  }
}

POST
curl --request POST \
  --url 'https://graph.facebook.com/{Version}/{WABA-ID}' \
  --header 'Authorization: Bearer <Token>' \
  --header 'Content-Type: application/json' \
  --data '{
  "name": "Updated Business Name"
}'

response:
{
  "success": true
}

--WHATSAPP FLOW
--FLOW ENDPOINT (Data Exchange)

Your server must expose a POST HTTPS endpoint. Meta calls it; you don't call Meta for this one.

REQ (raw HTTP body — always encrypted)
POST https://your-domain.com/your-flow-endpoint
Content-Type: application/json

{
  "encrypted_flow_data": "<base64>",
  "encrypted_aes_key": "<base64>",
  "initial_vector": "<base64>"
}

RES (raw HTTP body — plain text, base64 AES-GCM ciphertext)
HTTP/2 200
Content-Type: text/plain

yZcJQaH3AqfzKgjn64vAcASaJrOMN27S6CESyU68WN/cDCP6ab...

> If decryption fails → return HTTP 421 (forces client to re-fetch your public key).


--DECRYPTED PAYLOAD: INIT (flow opens)

REQ (after decrypting encrypted_flow_data)
{
  "version": "3.0",
  "action": "INIT",
  "flow_token": "FLOW_TOKEN_123",
  "data": {}
}

RES (before encrypting)
{
  "screen": "APPOINTMENT_FORM",
  "data": {
    "available_slots": ["10:00", "11:00", "14:00"]
  }
}


--DECRYPTED PAYLOAD: data_exchange (screen submit)

REQ
{
  "version": "3.0",
  "action": "data_exchange",
  "screen": "APPOINTMENT_FORM",
  "flow_token": "FLOW_TOKEN_123",
  "data": {
    "selected_slot": "11:00",
    "customer_name": "Ara"
  },
  "flow_token_signature": "<JWT>"
}

RES — next screen
{
  "screen": "CONFIRMATION",
  "data": {
    "summary": "Appointment booked for 11:00",
    "error_message": ""
  }
}

RES — final/complete (closes the flow)
{
  "screen": "SUCCESS",
  "data": {
    "extension_message_response": {
      "params": {
        "flow_token": "FLOW_TOKEN_123",
        "appointment_id": "APT_9981"
      }
    }
  }
}


--DECRYPTED PAYLOAD: BACK (user presses back, refresh_on_back: true)

REQ
{
  "version": "3.0",
  "action": "BACK",
  "screen": "CONFIRMATION",
  "flow_token": "FLOW_TOKEN_123",
  "data": {}
}

RES
{
  "screen": "APPOINTMENT_FORM",
  "data": {
    "available_slots": ["10:00", "14:00"]
  }
}


--ERROR NOTIFICATION (client tells you your last response was invalid)

REQ
{
  "version": "3.0",
  "flow_token": "FLOW_TOKEN_123",
  "action": "data_exchange",
  "data": {
    "error": "INVALID_SCREEN_RESPONSE",
    "error_message": "missing required field"
  }
}

RES
{
  "data": {
    "acknowledged": true
  }
}


--HEALTH CHECK (periodic ping from WhatsApp)

REQ
{
  "version": "3.0",
  "action": "ping"
}

RES
{
  "data": {
    "status": "active"
  }
}


--HEADERS ON EVERY INCOMING REQUEST

X-Hub-Signature-256: sha256=<hmac_sha256(body, app_secret)>

Validate this to confirm the request is genuinely from Meta before decrypting.

APPOINTMENT API:
 GET:

 req


POST:

req:

UPDATE:

req:

