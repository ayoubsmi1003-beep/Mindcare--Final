# Document renderer v2

A5 portrait, 148 × 210 mm. Assets supplied for this task, with their original viewport nested inside a cropped outer SVG (changing the inner viewport clips percentage-based masks). Embedded raster images, filters, masks and alpha are preserved. The watermark already carries its transparency: no second opacity reduction.

Latin: local Windows Arial (visual correspondence, exact reference typeface unverified). Arabic: Windows Traditional Arabic, then Times New Roman and the immutable DocumentSans fonts from v1 as offline fallbacks. Colours are supplied from src/styles/tokens.css to preview and print. v1 files remain untouched.

Identity and address come from the database snapshot. Social labels come from profiles.signature_block.document_footer.facebook_label / instagram_label. The explicitly approved public professional reference is centralized in resources/documents/cabinet-letterhead.json; runtime issuance still reads and freezes the configured database identity.
