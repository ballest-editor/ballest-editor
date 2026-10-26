/**
 * JSON writer matching Unreal's pretty-print policy as seen in game saves:
 * tab indentation, CRLF, object values open on their own line (Allman style),
 * arrays open on the key's line, empty arrays as `[]`, numbers as C `%.17g`, no
 * trailing newline. Formatting doesn't matter to the game's parser; matching it keeps
 * diffs against in-game saves clean.
 */

const EOL = "\r\n"

/** C printf `%.17g` (what UE uses for doubles). */
export const formatNumber = (n: number): string => {
  if (!Number.isFinite(n)) throw new RangeError(`Cannot write non-finite number ${n} to JSON`)
  if (Object.is(n, -0)) return "-0"
  if (n === 0) return "0"
  const { digits, exponent, sign } = toDigits17(n)
  if (exponent < -4 || exponent >= 17) {
    const mantissa = stripZeros(`${digits[0]}.${digits.slice(1)}`)
    return `${sign}${mantissa}e${exponent < 0 ? "-" : "+"}${String(Math.abs(exponent)).padStart(2, "0")}`
  }
  const fixed = exponent >= 0
    ? `${digits.slice(0, exponent + 1)}.${digits.slice(exponent + 1)}`
    : `0.${"0".repeat(-exponent - 1)}${digits}`
  return sign + stripZeros(fixed)
}

/**
 * The 17 significant digits of `n`, rounded like glibc's printf: correctly rounded, with
 * exact ties going to even. (`toExponential` breaks ties away from zero, e.g.
 * 184.154937744140625 must print as 184.15493774414062.) A tie needs the exact decimal
 * expansion to end at digit 18, which fits in toExponential's 100-digit limit.
 */
const toDigits17 = (n: number): { readonly digits: string; readonly exponent: number; readonly sign: string } => {
  const split = (s: string) => {
    const eIndex = s.indexOf("e")
    const sign = s.startsWith("-") ? "-" : ""
    return { digits: s.slice(sign.length, eIndex).replace(".", ""), exponent: Number(s.slice(eIndex + 1)), sign }
  }
  const full = split(n.toExponential(99))
  const isTie = full.digits[17] === "5" && /^0*$/.test(full.digits.slice(18))
  if (isTie && Number(full.digits[16]) % 2 === 0) {
    return { ...full, digits: full.digits.slice(0, 17) }
  }
  return split(n.toExponential(16))
}

const stripZeros = (s: string): string => (s.includes(".") ? s.replace(/\.?0+$/, "") : s)

const isPlainObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const writeScalar = (value: unknown): string => {
  if (value === null) return "null"
  switch (typeof value) {
    case "string":
      return JSON.stringify(value)
    case "number":
      return formatNumber(value)
    case "boolean":
      return value ? "true" : "false"
    default:
      throw new TypeError(`Cannot write ${typeof value} to JSON`)
  }
}

const tabs = (n: number): string => "\t".repeat(n)

const writeObject = (obj: Readonly<Record<string, unknown>>, depth: number, out: Array<string>): void => {
  const keys = Object.keys(obj).filter((key) => obj[key] !== undefined)
  out.push("{")
  keys.forEach((key, i) => {
    const value = obj[key]
    out.push(EOL, tabs(depth + 1), JSON.stringify(key), ":")
    if (isPlainObject(value)) {
      out.push(EOL, tabs(depth + 1))
      writeObject(value, depth + 1, out)
    } else if (Array.isArray(value)) {
      out.push(" ")
      writeArray(value, depth + 1, out)
    } else {
      out.push(" ", writeScalar(value))
    }
    if (i < keys.length - 1) out.push(",")
  })
  out.push(EOL, tabs(depth), "}")
}

const writeArray = (arr: ReadonlyArray<unknown>, depth: number, out: Array<string>): void => {
  if (arr.length === 0) {
    out.push("[]")
    return
  }
  out.push("[")
  arr.forEach((value, i) => {
    out.push(EOL, tabs(depth + 1))
    writeValue(value, depth + 1, out)
    if (i < arr.length - 1) out.push(",")
  })
  out.push(EOL, tabs(depth), "]")
}

const writeValue = (value: unknown, depth: number, out: Array<string>): void => {
  if (isPlainObject(value)) writeObject(value, depth, out)
  else if (Array.isArray(value)) writeArray(value, depth, out)
  else out.push(writeScalar(value))
}

export const stringifyUe = (value: unknown): string => {
  const out: Array<string> = []
  writeValue(value, 0, out)
  return out.join("")
}
