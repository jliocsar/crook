declare module 'wawoff2/decompress' {
  export default function decompress(woff2: Uint8Array): Promise<Uint8Array>
}
