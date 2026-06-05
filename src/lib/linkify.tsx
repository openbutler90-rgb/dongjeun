/**
 * 텍스트 내 URL을 클릭 가능한 <a> 태그 JSX로 변환
 */
export function linkifyText(text: string): (string | JSX.Element)[] {
  if (!text) return [];
  const urlRegex = /(https?:\/\/[^\s<>"'()]+)/g;
  const parts = text.split(urlRegex);
  const matches = text.match(urlRegex) || [];

  const result: (string | JSX.Element)[] = [];
  let matchIdx = 0;

  for (let i = 0; i < parts.length; i++) {
    if (parts[i]) {
      result.push(parts[i]);
    }
    if (matchIdx < matches.length) {
      const url = matches[matchIdx];
      result.push(
        <a
          key={`link-${matchIdx}-${url.slice(-20)}`}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-indigo-600 underline underline-offset-2 break-all hover:text-indigo-800"
          onClick={(e) => e.stopPropagation()}
        >
          {url}
        </a>
      );
      matchIdx++;
    }
  }

  return result;
}
