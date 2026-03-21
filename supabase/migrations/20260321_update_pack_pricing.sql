-- Migration: Update recharge pack prices
-- Date: 2026-03-21
-- Basic: ₹79 → ₹99 | Romantic: ₹149 → ₹199 | Soulmate: ₹249 → ₹349

UPDATE riya_recharge_packs SET price_inr = 99  WHERE pack_name = 'basic';
UPDATE riya_recharge_packs SET price_inr = 199 WHERE pack_name = 'romantic';
UPDATE riya_recharge_packs SET price_inr = 349 WHERE pack_name = 'soulmate';
