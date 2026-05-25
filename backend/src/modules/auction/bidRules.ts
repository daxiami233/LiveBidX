type BidRuleInput = {
  amount: number;
  currentPrice: number;
  minIncrement: number;
  capPrice?: number | null;
  endTime?: Date | null;
  autoExtendSec?: number | null;
  now?: Date;
};

export function calculateBidUpdate({
  amount,
  currentPrice,
  minIncrement,
  capPrice,
  endTime,
  autoExtendSec = 15,
  now = new Date()
}: BidRuleInput) {
  const roundedAmount = capPrice ? Math.min(Math.round(amount), capPrice) : Math.round(amount);
  const minAmount = currentPrice + minIncrement;

  if (roundedAmount < minAmount) {
    throw new Error(`出价需不低于 ${minAmount}`);
  }

  const autoExtendMs = Math.max(0, autoExtendSec ?? 15) * 1000;
  const shouldExtend = autoExtendMs > 0 && endTime && endTime.getTime() - now.getTime() <= autoExtendMs;

  return {
    amount: roundedAmount,
    nextEndTime: shouldExtend && endTime ? new Date(endTime.getTime() + autoExtendMs) : endTime ?? null
  };
}
