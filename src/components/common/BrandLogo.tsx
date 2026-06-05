interface BrandLogoProps {
  size?: 'sm' | 'md' | 'lg';
  showText?: boolean;
  className?: string;
}

const sizeMap = {
  sm: { mark: 'w-8 h-8', word: 'h-5 w-auto max-w-[104px]', gap: 'gap-1.5' },
  md: { mark: 'w-12 h-12', word: 'h-9 w-auto max-w-[176px]', gap: 'gap-2' },
  lg: { mark: 'w-20 h-20', word: 'h-14 w-auto max-w-[288px]', gap: 'gap-4' },
};

export function BrandLogo({ size = 'sm', showText = true, className = '' }: BrandLogoProps) {
  const styles = sizeMap[size];

  return (
    <div className={`inline-flex items-center ${styles.gap} ${className}`}>
      <img src="/logo.png?v=20260517b" alt="동전커피" className={`${styles.mark} object-contain shrink-0`} />
      {showText && (
        <img src="/wordmark.png?v=20260517b" alt="동전커피" className={`${styles.word} object-contain object-left shrink-0`} />
      )}
    </div>
  );
}
