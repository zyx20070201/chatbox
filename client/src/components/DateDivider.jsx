import React from 'react';
import { formatDateDivider } from '../utils';

export default function DateDivider({ date }) {
  return (
    <div className="flex justify-center my-4">
      <div className="bg-gray-100 text-gray-500 text-xs px-3 py-1 rounded-full border border-gray-200 shadow-sm">
        {formatDateDivider(date)}
      </div>
    </div>
  );
}
