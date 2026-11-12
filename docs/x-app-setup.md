# X app setup

Requirements for connecting an X account.

## Accounts

- Sender account: the X account that sends the DMs. Set a Chat passcode on it (Settings > Chat). Without a passcode the DM compose window has no message box.
- Test recipient: a second X account you control, or a person who agreed to receive test messages.

## Create the app

1. Sign in at https://console.x.com with the sender account and register as a developer.
2. Create an app, then open User authentication settings and set:
   - App permissions: Read and write and Direct message
   - Type of app: Web App, Automated App or Bot (confidential client)
   - Callback URI: `http://localhost:3000/api/auth/x/callback`
   - Website URL: any valid public URL (`localhost` is rejected)
3. Save. Copy the Client ID and Client Secret. The secret is shown once; regenerate it if lost.
4. Put them in `.env` as `X_CLIENT_ID` and `X_CLIENT_SECRET`.

## Scopes

`dm.read dm.write tweet.read users.read follows.read offline.access`

A missing scope returns `403 Forbidden` without naming the scope. `follows.read` is required for followers and following.

## Credits

- Plan: pay-per-use

Pricing: https://docs.x.com/x-api/getting-started/pricing.md

## Tokens

- Access token lifetime is 2 hours. The refresh token (scope `offline.access`) renews it.
- A missing token returns `401`. An invalid token returns `403 unsupported-authentication`. A failed refresh returns `400 invalid_client`.

## Rate limits observed

From the `x-rate-limit-limit` response header on the pay-per-use plan.

| Item | Value |
| --- | --- |
| DM event read | 15 requests per 15 minutes |
| User lookup | 900 requests per 15 minutes |
| Recent search | 300 requests per 15 minutes |
| Followers / following read | 10,000 requests per 15 minutes |
| DM send | 99 requests per 15 minutes |

## Sending behaviour

| Recipient | API send result | Where the recipient sees it |
| --- | --- | --- |
| Follows the sender, or has an existing conversation | `201` | Main chat list |
| Stranger who accepts DMs | `201` | Message Requests > Other |
| Does not accept DMs | `403` `dm-recipient-not-accepting` | Not delivered |

`receives_your_dm` on the user object predicts the `403` case. It can lag after the recipient changes the setting.

`https://x.com/messages/compose?recipient_id=<id>&text=<text>` opens the chat with the text filled in.

