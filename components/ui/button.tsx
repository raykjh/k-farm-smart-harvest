import * as React from 'react';
import {Slot} from '@radix-ui/react-slot';
import {cva,type VariantProps} from 'class-variance-authority';
import {clsx} from 'clsx';
import {twMerge} from 'tailwind-merge';
const variants=cva('inline-flex items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed',{variants:{variant:{default:'bg-emerald-800 text-white hover:bg-emerald-900',outline:'border border-stone-300 bg-white text-stone-700 hover:bg-stone-50',danger:'bg-rose-700 text-white hover:bg-rose-800'},size:{default:'px-4 py-3',sm:'px-3 py-2'}},defaultVariants:{variant:'default',size:'default'}});
export function Button({className,variant,size,asChild=false,...props}:React.ButtonHTMLAttributes<HTMLButtonElement>&VariantProps<typeof variants>&{asChild?:boolean}){const Comp=asChild?Slot:'button';return <Comp className={twMerge(clsx(variants({variant,size}),className))} {...props}/>;}
