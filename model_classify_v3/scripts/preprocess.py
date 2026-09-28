"""
model_classify_v3/scripts/preprocess.py
=======================================
Robust Vietnamese text preprocessing:
- Unicode NFC normalization
- Preserves all Vietnamese diacritics (ă, â, ê, ô, ơ, ư, đ, dấu hỏi/ngã/nặng/sắc/huyền)
- Strips punctuation and extraneous symbols
- Normalizes whitespace
- Utility for accent stripping for typo/no-diacritics evaluation and augmentation
"""

import re
import unicodedata
from typing import Optional, List


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
    # 3. Replace underscores, hyphens, slashes with spaces
    text = re.sub(r"[_\-/\\]", " ", text)
    # 4. Remove punctuation but KEEP all Unicode letters (including all Vietnamese diacritics) and digits
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


def extract_ngrams(
    text: str,
    use_word: bool = True,
    max_word_ngram: int = 2,
    use_char: bool = True,
    min_char_ngram: int = 3,
    max_char_ngram: int = 4,
) -> List[str]:
    """
    Extract hybrid Word + Character n-grams for robust Vietnamese classification.
    """
    cleaned = clean_vietnamese_text(text)
    tokens: List[str] = []
    if not cleaned:
        return tokens

    words = cleaned.split()

    # 1. Word n-grams
    if use_word and words:
        for n in range(1, max_word_ngram + 1):
            for i in range(len(words) - n + 1):
                tokens.append("w:" + " ".join(words[i:i + n]))

    # 2. Character n-grams
    if use_char and cleaned:
        padded = f" {cleaned} "
        for n in range(min_char_ngram, max_char_ngram + 1):
            for i in range(len(padded) - n + 1):
                tokens.append("c:" + padded[i:i + n])

    return tokens
