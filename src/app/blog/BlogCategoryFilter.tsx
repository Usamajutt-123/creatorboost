'use client';

import { useState } from 'react';
import Select from '@/components/Select';

interface BlogCategoryFilterProps {
  categories: string[];
  currentCategory: string;
}

/**
 * Dark-themed category dropdown for /blog. Replaces the native `<select>`
 * whose browser/OS light popup broke the dark theme. A hidden input with the
 * same `name="category"` keeps the existing GET form / Search button flow
 * (categories and filtering behavior) unchanged.
 */
export default function BlogCategoryFilter({ categories, currentCategory }: BlogCategoryFilterProps) {
  const [category, setCategory] = useState(currentCategory);

  return (
    <>
      <input type="hidden" name="category" value={category} />
      <Select
        value={category}
        onChange={setCategory}
        ariaLabel="Filter by category"
        options={[
          { value: '', label: 'All categories' },
          ...categories.map(item => ({ value: item, label: item })),
        ]}
        className="h-full"
        triggerClassName="h-full"
      />
    </>
  );
}
