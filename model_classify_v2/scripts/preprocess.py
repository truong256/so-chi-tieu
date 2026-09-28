"""
model_classify_v2/scripts/preprocess.py
=======================================
Robust Vietnamese text preprocessing:
- Unicode NFC normalization
- Preserves all Vietnamese diacritics (ă, â, ê, ô, ơ, ư, đ, dấu hỏi/ngã/nặng/sắc/huyền)
- Strips punctuation and extraneous symbols
- Normalizes whitespace
- Utility for accent stripping for typo/no-diacritics evaluation
"""

import re
import unicodedata
from typing import Optional


def clean_vietnamese_text(text: Optional[str]) -> str:
    """
    Clean and normalize Vietnamese transaction text while strictly preserving diacritics.
    Example:
        "Ăn phở bò 45K!" -> "ăn phở bò 45k"
        "Đổ xăng xe máy: 70.000đ" -> "đổ xăng xe máy 70 000đ"
    """
    if text is None:
        return ""
    text = str(text)
    # 1. Normalize to Unicode NFC standard
    text = unicodedata.normalize("NFC", text)
    # 2. Lowercase
    text = text.lower().strip()
    # 3. Replace underscores with spaces
    text = text.replace("_", " ")
    # 4. Remove punctuation but KEEP all Unicode letters (including all Vietnamese diacritics) and digits
    # \w matches [a-zA-Z0-9_] plus Unicode letters
    text = re.sub(r"[^\w\s]", " ", text)
    # 5. Collapse consecutive whitespaces
    text = re.sub(r"\s+", " ", text).strip()
    return text


def remove_vietnamese_accents(text: str) -> str:
    """
    Convert Vietnamese text with diacritics to plain ASCII without accents.
    Example:
        "ăn phở bò" -> "an pho bo"
        "tiền điện tháng 9" -> "tien dien thang 9"
    """
    if not text:
        return ""
    text = unicodedata.normalize("NFD", text)
    # Remove combining marks
    text = re.sub(r"[\u0300-\u036f]", "", text)
    # Handle d/D with bar
    text = text.replace("đ", "d").replace("Đ", "D")
    return unicodedata.normalize("NFC", text)


if __name__ == "__main__":
    sample = "Ăn phở bò 45K! Đổ xăng xe máy, tiền điện tháng 9/2026."
    cleaned = clean_vietnamese_text(sample)
    no_acc = remove_vietnamese_accents(cleaned)
    print("Original:     ", sample)
    print("Cleaned:      ", cleaned)
    print("No Diacritics:", no_acc)
