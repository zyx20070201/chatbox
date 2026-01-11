import { format, isToday, isYesterday, isSameYear, isSameDay } from 'date-fns';

export const formatDateDivider = (dateString) => {
  const date = new Date(dateString);
  if (isToday(date)) return 'Today';
  if (isYesterday(date)) return 'Yesterday';
  if (isSameYear(date, new Date())) return format(date, 'MMM d');
  return format(date, 'yyyy MMM d');
};

export const formatMessageTime = (dateString) => {
  return format(new Date(dateString), 'HH:mm');
};

export const formatFullTime = (dateString) => {
  return format(new Date(dateString), 'yyyy-MM-dd HH:mm:ss');
};

export const checkIsSameDay = (d1, d2) => {
    return isSameDay(new Date(d1), new Date(d2));
};

export const checkIsTimeGap = (d1, d2, thresholdMinutes = 5) => {
    const date1 = new Date(d1);
    const date2 = new Date(d2);
    const diff = Math.abs(date1 - date2);
    return diff > thresholdMinutes * 60 * 1000;
};

export const escapeHtml = (unsafe) => {
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
};
