# API Key Setup Guide

This guide explains how to configure multiple Gemini API keys for load balancing to avoid rate limiting on the free tier.

## Why Multiple API Keys?

The Gemini API free tier has rate limits. By using multiple API keys and distributing requests across them using a round-robin algorithm, you can:
- Handle more requests per minute
- Avoid hitting rate limits
- Provide a better user experience

## How It Works

The Edge Function automatically rotates through available API keys:
1. Request 1 → Uses `GEMINI_API_KEY_1`
2. Request 2 → Uses `GEMINI_API_KEY_2`
3. Request 3 → Uses `GEMINI_API_KEY_3`
4. Request 4 → Back to `GEMINI_API_KEY_1` (round-robin)

## Getting Multiple Gemini API Keys

1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Sign in with different Google accounts (or use the same account)
3. Create an API key for each account
4. Copy each API key

> **Tip**: You can create multiple API keys from the same Google account, or use different Google accounts for additional keys.

## Configuration in Supabase

### Option 1: Multiple Keys (Recommended for Production)

Set up numbered environment variables in your Supabase project:

1. Go to your Supabase project dashboard
2. Navigate to **Project Settings** → **Edge Functions** → **Secrets**
3. Add the following secrets:
   - `GEMINI_API_KEY_1` = `your-first-api-key`
   - `GEMINI_API_KEY_2` = `your-second-api-key`
   - `GEMINI_API_KEY_3` = `your-third-api-key`
   - ... (add as many as you need)

**Important**: 
- Keys must be numbered sequentially starting from 1
- No gaps in numbering (e.g., don't skip from `_1` to `_3`)
- The system will automatically detect how many keys you have

### Option 2: Single Key (Backward Compatible)

If you only have one API key, just set:
- `GEMINI_API_KEY` = `your-api-key`

The system will automatically fall back to using this single key.

## Verifying the Setup

After deploying your Edge Function, check the logs:

1. Go to **Edge Functions** → **chat** → **Logs**
2. Look for the initialization message:
   ```
   ✅ Initialized API key pool with 3 key(s)
   ```
3. For each request, you should see:
   ```
   🔑 Using API key #1 of 3
   🔑 Using API key #2 of 3
   🔑 Using API key #3 of 3
   🔑 Using API key #1 of 3  (rotates back)
   ```

## Troubleshooting

### "No API keys configured" Error

**Problem**: The Edge Function can't find any API keys.

**Solution**: Make sure you've set at least one of:
- `GEMINI_API_KEY_1`, `GEMINI_API_KEY_2`, etc., OR
- `GEMINI_API_KEY`

### Keys Not Rotating

**Problem**: The same key is being used for all requests.

**Solution**: 
- Verify you have multiple keys configured (`GEMINI_API_KEY_1`, `GEMINI_API_KEY_2`, etc.)
- Check that keys are numbered sequentially without gaps
- Redeploy the Edge Function after adding new keys

### Still Getting Rate Limited

**Problem**: Even with multiple keys, you're hitting rate limits.

**Solution**:
- Add more API keys
- Implement request throttling on the frontend
- Consider upgrading to a paid Gemini API tier

## Best Practices

1. **Start with 3-5 keys** for most applications
2. **Monitor your logs** to see the distribution pattern
3. **Test thoroughly** before deploying to production
4. **Keep keys secure** - never commit them to version control
5. **Rotate keys periodically** for security

## Example Configuration

For a production app with moderate traffic:

```
GEMINI_API_KEY_1=AIzaSyAbc123...
GEMINI_API_KEY_2=AIzaSyDef456...
GEMINI_API_KEY_3=AIzaSyGhi789...
GEMINI_API_KEY_4=AIzaSyJkl012...
GEMINI_API_KEY_5=AIzaSyMno345...
```

This gives you 5x the rate limit capacity of a single key!
