interface ProductInfoStepProps {
  productName: string
  companyName: string
  website: string
  onChange: (info: { productName: string; companyName: string; website: string }) => void
}

export function ProductInfoStep({
  productName,
  companyName,
  website,
  onChange,
}: ProductInfoStepProps) {
  const inputClass =
    'w-full rounded-lg border border-slate-700 bg-slate-800/50 px-4 py-3 text-white placeholder-slate-500 outline-none transition-colors focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500'

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold text-white">Tell us about your product</h2>
        <p className="text-slate-400">This helps APEX personalize your workspace.</p>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-slate-300">
            Product Name <span className="text-rose-500">*</span>
          </label>
          <input
            type="text"
            placeholder="e.g. MyApp"
            value={productName}
            onChange={(e) => onChange({ productName: e.target.value, companyName, website })}
            className={inputClass}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-slate-300">
            Company Name <span className="text-rose-500">*</span>
          </label>
          <input
            type="text"
            placeholder="e.g. Acme Inc."
            value={companyName}
            onChange={(e) => onChange({ productName, companyName: e.target.value, website })}
            className={inputClass}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-slate-300">
            Website <span className="text-slate-500 text-xs font-normal">(optional)</span>
          </label>
          <input
            type="url"
            placeholder="https://yourproduct.com"
            value={website}
            onChange={(e) => onChange({ productName, companyName, website: e.target.value })}
            className={inputClass}
          />
        </div>
      </div>
    </div>
  )
}
