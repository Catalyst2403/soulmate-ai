# System Prompt Auto-Update Solution

## 🎯 Problem Statement

**Issue:** When you update the system prompt code and push to GitHub/Supabase, existing users don't see the changes because:
1. System prompt is generated **once** during onboarding
2. It's stored in the `personas.system_prompt` database column
3. Chat page reads from the database, not from code
4. Only **new users** get the updated prompt

## ✅ Solution Implemented

### **Architecture Overview**

```
┌─────────────────────────────────────────────────────────────┐
│  BEFORE (Problem)                                           │
├─────────────────────────────────────────────────────────────┤
│  1. Onboarding → Generate Prompt → Save to DB              │
│  2. Chat Page → Read from DB → Use OLD prompt forever      │
│  3. Update Code → Only affects NEW users                   │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  AFTER (Solution)                                           │
├─────────────────────────────────────────────────────────────┤
│  1. Onboarding → Generate Prompt → Save to DB              │
│  2. Chat Page → Regenerate Prompt → Compare → Update DB    │
│  3. Update Code → ALL users get new prompt on next visit   │
└─────────────────────────────────────────────────────────────┘
```

### **Implementation Details**

#### 1. **Centralized System Prompt Generator**
**File:** `src/utils/systemPrompt.ts`

- Single source of truth for system prompt generation
- Used by both onboarding AND chat page
- Includes version tracking (currently v2)

```typescript
export const generateSystemPromptFromPersona = (persona: Persona): string => {
  // Single template used everywhere
}

export const SYSTEM_PROMPT_VERSION = 2; // Increment when you update prompt
```

#### 2. **Onboarding Flow** (No Changes to Logic)
**File:** `src/hooks/useOnboarding.ts`

- Now uses centralized generator
- Still saves to database during onboarding
- Cleaner code (no duplication)

#### 3. **Auto-Update on Chat Load**
**File:** `src/pages/Chat.tsx`

**New Logic:**
```typescript
loadUserData() {
  1. Load persona from database
  2. Regenerate system prompt from persona data
  3. Compare: old prompt vs new prompt
  4. If different → Update database
  5. Use updated prompt for chat
}
```

**Console Output:**
```
🔄 System prompt outdated. Updating to latest version...
Old prompt length: 1234
New prompt length: 1456
✅ System prompt updated successfully!
```

Or if already up to date:
```
✅ System prompt is up to date
```

## 🔄 How It Works

### **When You Update the System Prompt:**

1. **Edit** `src/utils/systemPrompt.ts`
2. **Increment** `SYSTEM_PROMPT_VERSION` (optional, for tracking)
3. **Push** to GitHub/Deploy to Vercel
4. **Next time ANY user loads chat:**
   - System regenerates prompt from their persona data
   - Compares with stored prompt
   - Updates database if different
   - User gets latest prompt immediately

### **Flow Diagram:**

```
User Opens Chat
    ↓
Load Persona from DB
    ↓
Regenerate Prompt (using latest code)
    ↓
Compare: DB Prompt vs Generated Prompt
    ↓
┌───────────────┬───────────────┐
│   Different   │   Same        │
├───────────────┼───────────────┤
│ Update DB     │ Do Nothing    │
│ Log: 🔄       │ Log: ✅       │
└───────────────┴───────────────┘
    ↓
Use Updated Prompt for Chat
```

## 📝 Files Modified

### Created:
- ✅ `src/utils/systemPrompt.ts` - Centralized prompt generator

### Modified:
- ✅ `src/hooks/useOnboarding.ts` - Uses centralized generator
- ✅ `src/pages/Chat.tsx` - Auto-regenerates and updates prompts
- ✅ `src/pages/Index.tsx` - Already has debug logging

## 🧪 Testing the Solution

### **Test 1: Existing User Gets Updated Prompt**

1. **Have an existing user** (already completed onboarding)
2. **Update** the system prompt in `src/utils/systemPrompt.ts`
3. **Reload** the chat page
4. **Check console** - should see:
   ```
   🔄 System prompt outdated. Updating to latest version...
   ✅ System prompt updated successfully!
   ```
5. **Send a message** - AI uses new prompt

### **Test 2: New User Gets Latest Prompt**

1. **Clear localStorage** or use new email
2. **Complete onboarding**
3. **Check console** - should see the new prompt in:
   ```
   === ONBOARDING COMPLETION DEBUG ===
   ```
4. **Chat page** - should see:
   ```
   ✅ System prompt is up to date
   ```

### **Test 3: Verify Database Update**

1. **Before update:** Check Supabase personas table
2. **Update prompt** in code
3. **User loads chat**
4. **After update:** Check Supabase - `system_prompt` column should be updated

## 🎯 Key Benefits

### ✅ **Automatic Updates**
- No manual database updates needed
- No migration scripts required
- Works for all existing users

### ✅ **Transparent**
- Console logs show what's happening
- Easy to debug
- Clear feedback

### ✅ **Efficient**
- Only updates when needed (comparison check)
- Happens once per user per prompt change
- No performance impact

### ✅ **Maintainable**
- Single source of truth
- No code duplication
- Easy to update prompt

## 🔧 How to Update System Prompt (Going Forward)

### **Step 1: Edit the Prompt**
```typescript
// src/utils/systemPrompt.ts
export const generateSystemPromptFromPersona = (persona: Persona): string => {
  return `You are NOT an AI. You are **${persona.identity_name}**.
  
  // ... your changes here ...
  `;
};
```

### **Step 2: Increment Version (Optional)**
```typescript
export const SYSTEM_PROMPT_VERSION = 3; // Was 2, now 3
```

### **Step 3: Deploy**
```bash
git add .
git commit -m "Updated system prompt"
git push
```

### **Step 4: Verify**
- Existing users: Will auto-update on next chat load
- New users: Get new prompt during onboarding
- Check console logs to confirm

## 📊 Console Log Reference

### **During Onboarding:**
```
=== ONBOARDING COMPLETION DEBUG ===
Generated System Prompt:
[Full prompt text]
Form Data: {...}
===================================
```

### **On Chat Load (Needs Update):**
```
🔄 System prompt outdated. Updating to latest version...
Old prompt length: 1234
New prompt length: 1456
✅ System prompt updated successfully!
```

### **On Chat Load (Already Updated):**
```
✅ System prompt is up to date
```

### **When Sending Message:**
```
=== CHAT DEBUG SESSION ===
System Prompt: [Current prompt]
========================

=== EDGE FUNCTION DEBUG SESSION ===
FULL SYSTEM PROMPT:
[Prompt sent to AI]
==================================
```

## 🚨 Important Notes

1. **Database Schema:** Make sure the migration `20251207_update_personas_schema.sql` has been run on your Supabase instance

2. **Type Safety:** The Supabase generated types might be outdated. We use `as unknown as Persona` to handle this safely.

3. **Performance:** The comparison is string-based. If the prompt is identical, no database update occurs.

4. **Backwards Compatible:** Old users with old schema will still work (if migration hasn't run yet)

## 🎉 Summary

**Before:** System prompt updates only affected new users
**After:** System prompt updates affect ALL users automatically

**How:** Chat page regenerates prompt from persona data and updates database if changed

**When:** Every time a user loads the chat page (but only updates if prompt changed)

**Result:** You can now update the system prompt anytime, and all users get it immediately! 🚀
