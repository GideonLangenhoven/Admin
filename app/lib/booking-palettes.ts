import type { OperatorColors } from "./theme-engine";

export type BookingPalette = Record<`color_${keyof OperatorColors}`, string>;

// Store the same six fields as custom colours so presets use the existing save flow.
export const BOOKING_PALETTES: Record<string, BookingPalette> = {
    "Gentle Sea Breeze": { color_main: "#1F7A8C", color_secondary: "#022B3A", color_cta: "#1F7A8C", color_bg: "#E1E5F2", color_nav: "#FFFFFF", color_hover: "#BFDBF7" },
    "Earthy Green": { color_main: "#52796F", color_secondary: "#2F3E46", color_cta: "#52796F", color_bg: "#CAD2C5", color_nav: "#F2F4F0", color_hover: "#84A98C" },
    "Cherry Blossom": { color_main: "#BD632F", color_secondary: "#273E47", color_cta: "#A4243B", color_bg: "#D8C99B", color_nav: "#F8F5EE", color_hover: "#D8973C" },
    "Soft Sand": { color_main: "#D5BDAF", color_secondary: "#4A4036", color_cta: "#D5BDAF", color_bg: "#F5EBE0", color_nav: "#FFFFFF", color_hover: "#D6CCC2" },
    "Golden Summer Fields": { color_main: "#D4A373", color_secondary: "#3D4A27", color_cta: "#D4A373", color_bg: "#FEFAE0", color_nav: "#FFFFFF", color_hover: "#E9EDC9" },
    "Pastel Dreams": { color_main: "#FF99C8", color_secondary: "#2D3748", color_cta: "#FF99C8", color_bg: "#FCF6BD", color_nav: "#FFFFFF", color_hover: "#D0F4DE" },
    "Purple Haze": { color_main: "#A167A5", color_secondary: "#0E273C", color_cta: "#A167A5", color_bg: "#E8D7F1", color_nav: "#F8F4FA", color_hover: "#D3BCCC" },

    "Atlantic Copper": { color_main: "#18566A", color_secondary: "#18343D", color_cta: "#A34F2D", color_bg: "#EAF2F3", color_nav: "#F6FAFA", color_hover: "#D9A27C" },
    "Lagoon Linen": { color_main: "#146B68", color_secondary: "#173C3A", color_cta: "#17665D", color_bg: "#F2EFE5", color_nav: "#FAF8F1", color_hover: "#83C5B5" },
    "Coral Coast": { color_main: "#225E68", color_secondary: "#243E43", color_cta: "#B34739", color_bg: "#FBEEE7", color_nav: "#FFFAF6", color_hover: "#E5A28D" },
    "Mediterranean Blue": { color_main: "#235A91", color_secondary: "#20364D", color_cta: "#A35227", color_bg: "#EFF4F8", color_nav: "#F9FBFD", color_hover: "#A7C8E2" },
    "Forest Fern": { color_main: "#28624A", color_secondary: "#203D30", color_cta: "#815426", color_bg: "#EAF1E8", color_nav: "#F6F9F3", color_hover: "#A2BE94" },
    "Sage & Stone": { color_main: "#496657", color_secondary: "#303D36", color_cta: "#506247", color_bg: "#EFF0E9", color_nav: "#F8F9F4", color_hover: "#B4C1A8" },
    "Olive Grove": { color_main: "#59632D", color_secondary: "#363D24", color_cta: "#8F4E2E", color_bg: "#F4F1E3", color_nav: "#FBF9EF", color_hover: "#BDC58D" },
    "Mountain Pine": { color_main: "#315B52", color_secondary: "#253E3A", color_cta: "#345C70", color_bg: "#E8EFED", color_nav: "#F5F9F7", color_hover: "#91B6AB" },
    "Desert Clay": { color_main: "#98503B", color_secondary: "#4D3932", color_cta: "#386466", color_bg: "#F4E8DD", color_nav: "#FCF6EF", color_hover: "#D4A184" },
    "Terracotta Sky": { color_main: "#AC4B35", color_secondary: "#493830", color_cta: "#2D6076", color_bg: "#FAEEE4", color_nav: "#FFFAF5", color_hover: "#DDA58D" },
    "Canyon Sand": { color_main: "#8C593D", color_secondary: "#493C32", color_cta: "#6D5733", color_bg: "#F1E8D8", color_nav: "#FBF6EC", color_hover: "#C7AF81" },
    "Safari Gold": { color_main: "#846019", color_secondary: "#3C3A28", color_cta: "#426044", color_bg: "#F7F0D9", color_nav: "#FDF9ED", color_hover: "#D7BE72" },
    "Fynbos Rose": { color_main: "#945367", color_secondary: "#45383E", color_cta: "#47664E", color_bg: "#F4E8E9", color_nav: "#FCF6F6", color_hover: "#CBACB4" },
    "Rosewood Cream": { color_main: "#8F4350", color_secondary: "#463238", color_cta: "#92512F", color_bg: "#F7EEE5", color_nav: "#FCF8F2", color_hover: "#D4A5A8" },
    "Burgundy Blush": { color_main: "#823749", color_secondary: "#402A33", color_cta: "#813C4B", color_bg: "#F5E9EC", color_nav: "#FCF6F8", color_hover: "#CDA0AA" },
    "Midnight Tide": { color_main: "#589398", color_secondary: "#102D36", color_cta: "#D6A775", color_bg: "#142E37", color_nav: "#193A43", color_hover: "#ACDDD8" },
    "Graphite Citrus": { color_main: "#87974E", color_secondary: "#282D26", color_cta: "#C5D58B", color_bg: "#252C28", color_nav: "#303A32", color_hover: "#DFE8B6" },
    "Charcoal Copper": { color_main: "#B27B51", color_secondary: "#302C2A", color_cta: "#D7A27B", color_bg: "#2B2928", color_nav: "#373230", color_hover: "#E8C4A5" },
    "Arctic Fjord": { color_main: "#3C6077", color_secondary: "#293C48", color_cta: "#326666", color_bg: "#EAF0F4", color_nav: "#F6F9FB", color_hover: "#A7C3CE" },
    "Porcelain Ink": { color_main: "#334A5C", color_secondary: "#263540", color_cta: "#435F57", color_bg: "#F0F2EF", color_nav: "#FAFBF8", color_hover: "#AEC2BB" },
};
