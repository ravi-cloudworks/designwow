// Standard NPCI UPI deep-link format — recognized by every UPI app (GPay,
// PhonePe, Paytm, BHIM). Purely a formatted string: no gateway, no API key,
// no money ever touches us. Tapped on mobile it opens the payer's UPI app
// with payee and amount pre-filled; encoded as a QR it works from desktop.
export function buildUpiLink({
  upiId,
  payeeName,
  amountRupees,
  note,
}: {
  upiId: string;
  payeeName: string;
  amountRupees: number;
  note: string;
}): string {
  const params = new URLSearchParams({
    pa: upiId,
    pn: payeeName,
    am: amountRupees.toFixed(2),
    cu: 'INR',
    tn: note,
  });
  return `upi://pay?${params.toString()}`;
}
