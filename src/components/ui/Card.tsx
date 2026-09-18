import React from "react";
import { cn } from "../../lib/utils";

type CardProps = React.ComponentProps<"div">;

export function Card({ className, ...props }: CardProps) {
  return (
    <div
      className={cn(
        "bg-white dark:bg-[#121212] rounded-[16px] shadow-[0_2px_12px_-4px_rgba(0,0,0,0.06)] border border-gray-100 dark:border-[#2A2F3A] overflow-hidden flex flex-col",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: CardProps) {
  return (
    <div
      className={cn("flex flex-col gap-1.5 p-5 md:p-6 pb-4", className)}
      {...props}
    />
  );
}

export function CardTitle({
  className,
  children,
  ...props
}: React.ComponentProps<"h3">) {
  return (
    <h3
      className={cn(
        "text-[17px] font-semibold text-gray-900 dark:text-[#fafafa] leading-tight tracking-tight",
        className,
      )}
      {...props}
    >
      {children}
    </h3>
  );
}

export function CardContent({ className, ...props }: CardProps) {
  return <div className={cn("p-5 md:p-6 pt-0 flex-1 flex flex-col gap-4", className)} {...props} />;
}
