import React, { useLayoutEffect, useRef, useState } from 'react';
import RadioGroup from '@mui/material/RadioGroup';
import type { RadioGroupProps } from '@mui/material/RadioGroup';
const SettingsRadioGroup: React.FC<Omit<RadioGroupProps, 'row' | 'sx'>> = ({ children, ...props }) => {
    const ref = useRef<HTMLDivElement>(null);
    const [stacked, setStacked] = useState(false);

    useLayoutEffect(() => {
        const group = ref.current!;
        const updateLayout = () => {
            const requiredWidth = Array.from(group.children).reduce((width, child) => {
                const style = getComputedStyle(child);
                return (
                    width +
                    child.getBoundingClientRect().width +
                    parseFloat(style.marginLeft) +
                    parseFloat(style.marginRight)
                );
            }, 0);
            setStacked(requiredWidth > group.clientWidth);
        };
        updateLayout();
        if (typeof ResizeObserver === 'undefined') return;

        const observer = new ResizeObserver(updateLayout);
        observer.observe(group);
        Array.from(group.children).forEach((child) => observer.observe(child));
        return () => observer.disconnect();
    }, []);

    return (
        <RadioGroup
            {...props}
            ref={ref}
            row={!stacked}
            sx={{
                flexWrap: 'nowrap',
                '& > .MuiFormControlLabel-root': { width: 'max-content', maxWidth: '100%', flexShrink: 0 },
            }}
        >
            {children}
        </RadioGroup>
    );
};

export default SettingsRadioGroup;
