---
name: creating-word-docs
description: Automates the creation of Microsoft Word documents (.docx). Use when the user asks to generate, build, export, or write a Word document.
---

# Creating Word Documents

## When to use this skill
- When the user explicitly requests to create or export a `.docx` or `.pdf` file.
- When drafting reports, letters, or structured text documents meant for Microsoft Word.
- When the user provides raw content and asks the bot to automatically create and send a perfect professional document and PDF.

## Workflow
- [ ] Understand the user's requirements for the document content, structure, and formatting.
- [ ] If the user provides raw content, structure it professionally (add title, headings, bullet points, conclusion) before generating the document.
- [ ] Determine the target directory for saving the document (e.g., current directory or a specific absolute path).
- [ ] Identify the appropriate tool or library to use (e.g., `docx` library in Python, Node.js `docx` package, and `pdf-lib` or `puppeteer` for PDF conversion).
- [ ] Generate the `.docx` file utilizing the determined approach.
- [ ] Generate a `.pdf` version of the document if requested or as a standard professional delivery.
- [ ] Provide the user with the path or send the newly created documents.

## Instructions
1. **Analyze Requirements**: Check if the user wants specific headings, paragraphs, bullet points, or tables. Transform raw string content into a well-structured professional document.
2. **Select Tooling**:
   - If using Python: Write a short script utilizing `python-docx` to construct the document programmatically, and optionally `docx2pdf` for PDF.
   - If using JS/TS: Write a script utilizing `docx` npm package, and a PDF generation library like `pdf-lib` or similar to create the PDF.
   - Run the script to generate both the `.docx` and `.pdf` files.
3. **Execution**: Avoid raw binary manipulation; always use an established library or tool to generate Word documents and PDFs.
4. **Clean up**: Delete the temporary generating script if it's no longer needed unless the user wants to keep it.

## Resources
- Ensure `python-docx` (Python) or `docx` (Node) is installed if script-based generation is chosen.
- Ensure appropriate PDF conversion libraries are available.
