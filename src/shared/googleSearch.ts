export function buildGoogleImageUrl(cleanedName: string): string {
  const query = cleanedName.trim();
  const params = new URLSearchParams({
    tbm: 'isch',
    udm: '2',
    q: query,
  });
  return `https://www.google.com/search?${params.toString()}`;
}
