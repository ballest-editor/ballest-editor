import { useEffect, useState } from "react"

/** The current time, updated every `intervalMs`: for "4 min ago" labels that have to keep up. */
export const useNow = (intervalMs = 30_000): number => {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}
