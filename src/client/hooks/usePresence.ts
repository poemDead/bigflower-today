import { useEffect, useRef, useState } from 'react';

export function usePresence(open: boolean, exitMs: number) {
  const [mounted, setMounted] = useState(open);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (open) {
      setMounted(true);
      return;
    }

    if (mounted) {
      timerRef.current = window.setTimeout(() => {
        setMounted(false);
        timerRef.current = null;
      }, exitMs);
    }

    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [exitMs, mounted, open]);

  return {
    mounted: open || mounted,
    closing: !open && mounted,
  };
}
