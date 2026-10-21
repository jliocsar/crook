export const shellQuoted = (text: string) => `'${text.replaceAll("'", String.raw`'\''`)}'`
