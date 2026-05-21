import type { ApiResult } from "@/types/common";
import { businessFailure, businessOk } from "@/business/businessResult";

export interface PayoutAmounts {
  gross_amount?: number | string | null;
  advance?: number | string | null;
  deduction?: number | string | null;
  bonus?: number | string | null;
}

export function computePayoutNet(
  gross: number | string | null | undefined,
  advance: number | string | null | undefined,
  deduction: number | string | null | undefined,
  bonus: number | string | null | undefined
): number {
  return (
    Number(gross || 0) +
    Number(bonus || 0) -
    Number(advance || 0) -
    Number(deduction || 0)
  );
}

export function mergePayoutAdjustments(
  existing: PayoutAmounts,
  input: Partial<PayoutAmounts> & { remarks?: string }
): { advance: number; deduction: number; bonus: number; remarks: string; net_amount: number } {
  const advance = Number(input.advance ?? existing.advance ?? 0);
  const deduction = Number(input.deduction ?? existing.deduction ?? 0);
  const bonus = Number(input.bonus ?? existing.bonus ?? 0);
  const remarks = input.remarks ?? (existing as { remarks?: string }).remarks ?? "";
  const net_amount = computePayoutNet(existing.gross_amount, advance, deduction, bonus);
  return { advance, deduction, bonus, remarks, net_amount };
}

export function canAdjustPayout(status: string | undefined | null): ApiResult<null> {
  if (status === "PAID") {
    return businessFailure("Cannot adjust a PAID payout");
  }
  return businessOk();
}

export function canMarkPayoutPaid(status: string | undefined | null): ApiResult<null> {
  if (status === "PAID") {
    return businessFailure("Payout already paid");
  }
  return businessOk();
}

export function payoutOutstanding(netTotal: number, paidTotal: number): number {
  return netTotal - paidTotal;
}
