-- Fix: standardise all recharge packs to 30-day validity
-- Soulmate was 45 days, now simplified to 30 days for consistent billing cycles

UPDATE riya_recharge_packs
SET validity_days = 30,
    description = '3,000 messages · 30 days · Unlimited photos'
WHERE name = 'soulmate';
