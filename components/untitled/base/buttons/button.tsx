"use client";

import type { FC, ReactElement, ReactNode } from "react";
import React, { isValidElement } from "react";
import type { ButtonProps as AriaButtonProps, LinkProps as AriaLinkProps } from "react-aria-components";
import { Button as AriaButton, Link as AriaLink } from "react-aria-components";
import { cx, sortCx } from "@/utils/cx";
import { isReactComponent } from "@/utils/is-react-component";

export const styles = sortCx({
    common: {
        root: [
            "group relative inline-flex h-max cursor-pointer items-center justify-center whitespace-nowrap outline-primary transition duration-100 ease-linear before:absolute focus-visible:outline-2 focus-visible:outline-offset-2",
            // When button is used within `InputGroup`
            "in-data-input-wrapper:shadow-xs in-data-input-wrapper:focus:!z-50 in-data-input-wrapper:in-data-leading:-mr-px in-data-input-wrapper:in-data-leading:rounded-r-none in-data-input-wrapper:in-data-leading:before:rounded-r-none in-data-input-wrapper:in-data-trailing:-ml-px in-data-input-wrapper:in-data-trailing:rounded-l-none in-data-input-wrapper:in-data-trailing:before:rounded-l-none",
            // Disabled styles
            "disabled:cursor-not-allowed disabled:opacity-50 in-data-input-wrapper:disabled:opacity-100",
            // Same as `icon` but for SSR icons that cannot be passed to the client as functions.
            "*:data-icon:pointer-events-none *:data-icon:size-5 *:data-icon:shrink-0 *:data-icon:transition-all",
        ].join(" "),
        icon: "pointer-events-none size-5 shrink-0 transition-all",
    },
    sizes: {
        xs: {
            root: [
                "gap-1 rounded-lg px-2.5 py-1.5 text-sm font-semibold before:rounded-[7px] data-icon-only:p-2",
                "in-data-input-wrapper:px-3.5 in-data-input-wrapper:py-2.5 in-data-input-wrapper:data-icon-only:p-2.5",
                "*:data-icon:size-4 *:data-icon:stroke-[2.25px]",
            ].join(" "),
            linkRoot: "gap-1 *:data-text:underline-offset-3",
        },
        sm: {
            root: [
                "gap-1 rounded-lg px-3 py-2 text-sm font-semibold before:rounded-[7px] data-icon-only:p-2",
                "in-data-input-wrapper:px-3.5 in-data-input-wrapper:py-2.5 in-data-input-wrapper:data-icon-only:p-2.5",
            ].join(" "),
            linkRoot: "gap-1 *:data-text:underline-offset-3",
        },
        md: {
            root: [
                "gap-1 rounded-lg px-3.5 py-2.5 text-sm font-semibold before:rounded-[7px] data-icon-only:p-2.5",
                "in-data-input-wrapper:gap-1.5 in-data-input-wrapper:px-4 in-data-input-wrapper:text-base in-data-input-wrapper:data-icon-only:p-3",
            ].join(" "),
            linkRoot: "gap-1 *:data-text:underline-offset-4",
        },
        lg: {
            root: "gap-1.5 rounded-lg px-4 py-2.5 text-base font-semibold before:rounded-[7px] data-icon-only:p-3",
            linkRoot: "gap-1.5 *:data-text:underline-offset-4",
        },
        xl: {
            root: "gap-1.5 rounded-lg px-4.5 py-3 text-base font-semibold before:rounded-[7px] data-icon-only:p-3.5",
            linkRoot: "gap-1.5 *:data-text:underline-offset-4",
        },
    },

    colors: {
        primary: {
            root: [
                "bg-primary text-primary-foreground shadow-xs-skeuomorphic ring-1 ring-transparent ring-inset hover:bg-primary/90 data-loading:bg-primary/90",
                // Inner border gradient
                "before:absolute before:inset-px before:border before:border-white/12 before:mask-b-from-0%",
                // Icon styles
                "*:data-icon:text-primary-foreground/60 hover:*:data-icon:text-primary-foreground/70",
            ].join(" "),
        },
        secondary: {
            root: [
                "bg-card text-foreground shadow-xs-skeuomorphic ring-1 ring-border ring-inset hover:bg-muted hover:text-foreground data-loading:bg-muted",
                // Icon styles
                "*:data-icon:text-muted-foreground/70 hover:*:data-icon:text-muted-foreground",
            ].join(" "),
        },
        tertiary: {
            root: [
                "text-muted-foreground hover:bg-muted hover:text-muted-foreground data-loading:bg-muted",
                // Icon styles
                "*:data-icon:text-muted-foreground/70 hover:*:data-icon:text-muted-foreground",
            ].join(" "),
        },
        "link-color": {
            root: [
                "justify-normal rounded p-0! text-primary hover:text-primary",
                // Inner text underline
                "*:data-text:underline *:data-text:decoration-transparent hover:*:data-text:decoration-fg-brand-secondary_alt",
                // Icon styles
                "*:data-icon:text-primary hover:*:data-icon:text-primary",
            ].join(" "),
        },
        "link-gray": {
            root: [
                "justify-normal rounded p-0! text-muted-foreground hover:text-muted-foreground",
                // Inner text underline
                "*:data-text:underline *:data-text:decoration-transparent hover:*:data-text:decoration-fg-quaternary",
                // Icon styles
                "*:data-icon:text-muted-foreground/70 hover:*:data-icon:text-muted-foreground",
            ].join(" "),
        },
        "primary-destructive": {
            root: [
                "bg-destructive text-destructive-foreground shadow-xs-skeuomorphic ring-1 ring-transparent outline-destructive ring-inset hover:bg-destructive/90 data-loading:bg-destructive/90",
                // Inner border gradient
                "before:absolute before:inset-px before:border before:border-white/12 before:mask-b-from-0%",
                // Icon styles
                "*:data-icon:text-primary-foreground/60 hover:*:data-icon:text-primary-foreground/70",
            ].join(" "),
        },
        "secondary-destructive": {
            root: [
                "bg-card text-destructive shadow-xs-skeuomorphic ring-1 ring-destructive/30 outline-destructive ring-inset hover:bg-destructive/10 hover:text-destructive data-loading:bg-destructive/10",
                // Icon styles
                "*:data-icon:text-destructive hover:*:data-icon:text-destructive",
            ].join(" "),
        },
        "tertiary-destructive": {
            root: [
                "text-destructive outline-destructive hover:bg-destructive/10 hover:text-destructive data-loading:bg-destructive/10",
                // Icon styles
                "*:data-icon:text-destructive hover:*:data-icon:text-destructive",
            ].join(" "),
        },
        "link-destructive": {
            root: [
                "justify-normal rounded p-0! text-destructive outline-destructive hover:text-destructive",
                // Inner text underline
                "*:data-text:underline *:data-text:decoration-transparent *:data-text:underline-offset-2 hover:*:data-text:decoration-current",
                // Icon styles
                "*:data-icon:text-destructive hover:*:data-icon:text-destructive",
            ].join(" "),
        },
    },
});

/**
 * Common props shared between button and anchor variants
 */
export interface CommonProps {
    /** Disables the button and shows a disabled state */
    isDisabled?: boolean;
    /** Shows a loading spinner and disables the button */
    isLoading?: boolean;
    /** The size variant of the button */
    size?: keyof typeof styles.sizes;
    /** The color variant of the button */
    color?: keyof typeof styles.colors;
    /** Icon component or element to show before the text */
    iconLeading?: FC<{ className?: string }> | ReactNode;
    /** Icon component or element to show after the text */
    iconTrailing?: FC<{ className?: string }> | ReactNode;
    /** Removes horizontal padding from the text content */
    noTextPadding?: boolean;
    /** When true, keeps the text visible during loading state */
    showTextWhileLoading?: boolean;

    children?: ReactNode;
    className?: string;
}

/**
 * Props for the button variant (non-link)
 */
export interface ButtonProps extends CommonProps, Omit<AriaButtonProps, "children" | "className"> {}
/**
 * Props for the link variant (anchor tag)
 */
interface LinkProps extends CommonProps, Omit<AriaLinkProps, "children" | "className"> {
    href: NonNullable<AriaLinkProps["href"]>;
}

/** Union type of button and link props */
export type Props = ButtonProps | LinkProps;

export const Button: {
    (props: LinkProps): ReactElement<LinkProps>;
    (props: ButtonProps): ReactElement<ButtonProps>;
} = ({
    size = "sm",
    color = "primary",
    children,
    className,
    noTextPadding,
    iconLeading: IconLeading,
    iconTrailing: IconTrailing,
    isDisabled: disabled,
    isLoading: loading,
    showTextWhileLoading,
    ...props
}) => {
    const href = "href" in props ? props.href : undefined;

    const isIcon = (IconLeading || IconTrailing) && !children;
    const isLinkType = ["link-gray", "link-color", "link-destructive"].includes(color);

    noTextPadding = isLinkType || noTextPadding;

    const commonChildren = (
        <>
            {/* Leading icon */}
            {isValidElement(IconLeading) && IconLeading}
            {isReactComponent(IconLeading) && <IconLeading data-icon="leading" className={styles.common.icon} />}

            {loading && (
                <svg
                    fill="none"
                    data-icon="loading"
                    viewBox="0 0 20 20"
                    className={cx(styles.common.icon, !showTextWhileLoading && "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2")}
                >
                    {/* Background circle */}
                    <circle className="stroke-current opacity-30" cx="10" cy="10" r="8" fill="none" strokeWidth="2" />
                    {/* Spinning circle */}
                    <circle
                        className="origin-center animate-spin stroke-current"
                        cx="10"
                        cy="10"
                        r="8"
                        fill="none"
                        strokeWidth="2"
                        strokeDasharray="12.5 50"
                        strokeLinecap="round"
                    />
                </svg>
            )}

            {children && (
                <span data-text className={cx("transition-all", !noTextPadding && "px-0.5")}>
                    {children}
                </span>
            )}

            {/* Trailing icon */}
            {isValidElement(IconTrailing) && IconTrailing}
            {isReactComponent(IconTrailing) && <IconTrailing data-icon="trailing" className={styles.common.icon} />}
        </>
    );

    const commonProps = {
        "data-loading": loading ? true : undefined,
        "data-icon-only": isIcon ? true : undefined,
        ...props,
        isDisabled: disabled,
        className: cx(
            styles.common.root,
            styles.sizes[size].root,
            styles.colors[color].root,
            isLinkType && styles.sizes[size].linkRoot,
            (loading || (href && (disabled || loading))) && "pointer-events-none",
            // If in `loading` state, hide everything except the loading icon (and text if `showTextWhileLoading` is true).
            loading && (showTextWhileLoading ? "[&>*:not([data-icon=loading]):not([data-text])]:hidden" : "[&>*:not([data-icon=loading])]:invisible"),
            className,
        ),
        children: commonChildren,
    };

    if ("href" in commonProps) {
        return <AriaLink {...commonProps} href={disabled ? undefined : href} />;
    }

    return <AriaButton {...commonProps} type={commonProps.type || "button"} isPending={loading} />;
};
