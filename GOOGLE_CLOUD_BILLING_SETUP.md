# Google Cloud Billing Setup Guide

This guide will help you configure Google Cloud Billing API integration to display real-time costs in your Riya Analytics dashboard.

## Prerequisites

- Google Cloud Platform account
- A GCP project with billing enabled
- Access to create service accounts

## Step 1: Enable Cloud Billing API

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project
3. Navigate to **APIs & Services** → **Library**
4. Search for "Cloud Billing API"
5. Click **Enable**

## Step 2: Create Service Account

1. Go to **IAM & Admin** → **Service Accounts**
2. Click **+ CREATE SERVICE ACCOUNT**
3. Fill in details:
   - **Name**: `riya-billing-reader`
   - **Description**: `Service account for reading billing data in Riya Analytics`
4. Click **CREATE AND CONTINUE**
5. Grant the role: **Billing Account Viewer**
6. Click **CONTINUE** → **DONE**

## Step 3: Create JSON Key

1. Click on the newly created service account
2. Go to **KEYS** tab
3. Click **ADD KEY** → **Create new key**
4. Select **JSON** format
5. Click **CREATE**
6. Save the downloaded JSON file securely

## Step 4: Get Your Billing Account ID

1. Go to **Billing** in Google Cloud Console
2. Note your Billing Account ID (format: `XXXXXX-YYYYYY-ZZZZZZ`)

## Step 5: Configure Supabase Secrets

### Encode Service Account JSON

**On Windows (PowerShell):**
```powershell
[Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes((Get-Content service-account.json -Raw)))
```

**On Mac/Linux:**
```bash
cat service-account.json | base64
```

Copy the output (base64 encoded string).

### Set Environment Variables

```bash
# Set the base64-encoded service account credentials
npx supabase secrets set GOOGLE_CLOUD_SERVICE_ACCOUNT="<paste-base64-here>"

# Set your GCP project ID
npx supabase secrets set GOOGLE_CLOUD_PROJECT_ID="your-project-id"

# Set your billing account ID (without "billingAccounts/" prefix)
npx supabase secrets set GOOGLE_CLOUD_BILLING_ACCOUNT_ID="XXXXXX-YYYYYY-ZZZZZZ"
```

## Step 6: Deploy Updated Function

```bash
npx supabase functions deploy riya-analytics --no-verify-jwt
```

## Step 7: Verify Integration

1. Open your Riya Analytics dashboard
2. Check the **Cost Metrics** section
3. Look for the green **● Live** indicator next to "Total API Cost"
4. If you see **Est.** in yellow, check the Supabase function logs for errors

## Troubleshooting

### Dashboard shows "Est." instead of "Live"

**Check function logs:**
```bash
npx supabase functions logs riya-analytics
```

**Common issues:**
- Service account JSON not properly base64 encoded
- Missing or incorrect environment variables
- Service account doesn't have Billing Account Viewer role
- Cloud Billing API not enabled

### Error: "Permission denied"

- Verify the service account has **Billing Account Viewer** role
- Make sure the billing account is linked to the project

### Error: "API not enabled"

- Enable Cloud Billing API in your GCP project
- Wait 1-2 minutes for propagation

## Expected Behavior

**With Credentials:**
- Dashboard shows actual costs from Google Cloud
- Green **● Live** indicator appears
- Billing period displays below the cost
- Data updates in real-time

**Without Credentials:**
- Dashboard shows calculated estimates
- Yellow **Est.** indicator appears
- Uses token-based cost calculations
- No errors in logs (graceful fallback)

## Security Notes

⚠️ **Never commit service account JSON files to version control**

✅ Store credentials only in Supabase secrets (encrypted)

✅ Use service accounts with minimal required permissions

✅ Rotate keys periodically for security
