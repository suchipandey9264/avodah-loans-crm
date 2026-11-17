// Follow-up labels shared by the Follow-ups page, the lead drawer and the customer profile.

export const FOLLOWUP_TYPES = [["call", "Call"], ["whatsapp", "WhatsApp"], ["meeting", "Meeting"], ["visit", "Visit"], ["email", "Email"]];
export const fuType = (t) => FOLLOWUP_TYPES.find(([id]) => id === t)?.[1] ?? t;
export const FU_STATE = { pending: ["Pending", "blue"], overdue: ["Overdue", "red"], done: ["Completed", "green"], cancelled: ["Cancelled", "gray"] };

/** Local "YYYY-MM-DDTHH:mm" for <input type="datetime-local">. */
export const toLocalInput = (date) => {
  const d = new Date(date);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
/** The next full hour, as a datetime-local value. */
export const inAnHour = () => {
  const d = new Date(Date.now() + 3600e3);
  d.setMinutes(0, 0, 0);
  return toLocalInput(d);
};
/** Local calendar-day key "YYYY-MM-DD". */
export const dayKey = (date) => toLocalInput(date).slice(0, 10);
