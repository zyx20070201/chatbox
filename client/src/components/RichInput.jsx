import React, { useRef, useEffect, forwardRef, useImperativeHandle } from 'react';

const RichInput = forwardRef(({ value, onChange, onEnter, placeholder }, ref) => {
  const divRef = useRef(null);

  useImperativeHandle(ref, () => ({
    focus: () => divRef.current?.focus(),
    execCommand: (command, value = null) => document.execCommand(command, false, value),
    getHtml: () => divRef.current?.innerHTML,
    setHtml: (html) => {
        if (divRef.current) divRef.current.innerHTML = html;
    }
  }));

  // Handle external value changes (reset)
  useEffect(() => {
    if (divRef.current && divRef.current.innerHTML !== value) {
        // Only update if significantly different to avoid cursor jump? 
        // Actually for chat reset, value becomes "" usually.
        if (value === '') {
            divRef.current.innerHTML = '';
        }
    }
  }, [value]);

  const handleInput = (e) => {
    onChange(e.currentTarget.innerHTML);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onEnter();
    }
  };

  return (
    <div
      ref={divRef}
      contentEditable
      className="flex-1 bg-transparent border-none focus:outline-none text-gray-900 overflow-y-auto max-h-32 min-h-[24px] cursor-text"
      onInput={handleInput}
      onKeyDown={handleKeyDown}
      style={{ whiteSpace: 'pre-wrap' }} // Maintain whitespace
      data-placeholder={placeholder}
    />
  );
});

export default RichInput;
