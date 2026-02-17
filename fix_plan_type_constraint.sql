-- Add instagram_monthly to the allowing plan types in riya_subscriptions
ALTER TABLE riya_subscriptions 
DROP CONSTRAINT IF EXISTS riya_subscriptions_plan_type_check;

ALTER TABLE riya_subscriptions 
ADD CONSTRAINT riya_subscriptions_plan_type_check 
CHECK (plan_type IN ('trial', 'monthly', 'quarterly', 'half_yearly', 'instagram_monthly'));
