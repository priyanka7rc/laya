/**
 * Date utility functions for Indian Standard Time (IST)
 * IST is UTC+5:30
 */

/**
 * Get current timestamp in Indian Standard Time (IST)
 * Format: YYYY-MM-DD HH:MM:SS IST
 */
export function getISTTimestamp(): string {
  const now = new Date();
  
  // IST is UTC+5:30
  const istOffset = 5.5 * 60 * 60 * 1000; // 5.5 hours in milliseconds
  const istTime = new Date(now.getTime() + istOffset);
  
  // Format as YYYY-MM-DD HH:MM:SS IST
  const isoString = istTime.toISOString();
  const datePart = isoString.split('T')[0];
  const timePart = isoString.split('T')[1].split('.')[0];
  
  return `${datePart} ${timePart} IST`;
}

/**
 * Get just the IST date (YYYY-MM-DD)
 */
export function getISTDate(): string {
  return getISTTimestamp().split(' ')[0];
}

/**
 * Format a Date object to IST timestamp string
 */
export function formatISTTimestamp(date: Date): string {
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istTime = new Date(date.getTime() + istOffset);
  
  const isoString = istTime.toISOString();
  const datePart = isoString.split('T')[0];
  const timePart = isoString.split('T')[1].split('.')[0];
  
  return `${datePart} ${timePart} IST`;
}
