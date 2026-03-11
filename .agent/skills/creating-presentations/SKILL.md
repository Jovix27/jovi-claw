---
name: creating-presentations
description: Automates the creation of PowerPoint presentations (.pptx). Use when the user requests generating slides, a presentation, or a PPT file.
---

# Creating Presentations

## When to use this skill
- When the user asks to create or generate a PowerPoint (`.pptx`) presentation.
- When transforming a structured outline or report into presentation slides.

## Workflow
- [ ] Gather the topic, outline, and number of slides requested by the user.
- [ ] Determine the content for each slide (Title, Content, bullet points).
- [ ] Check for available tools (e.g., Python's `python-pptx` library, Node.js `pptxgenjs`, or Marp for markdown-to-pdf/pptx).
- [ ] Write a script to instantiate the presentation, add slides, populate data, and save the file.
- [ ] Execute the build script and hand off the resulting `.pptx` file to the user.

## Instructions
1. **Slide Planning**: Briefly plan the slide deck structure (Title slide, Agenda, Content slides, Conclusion).
2. **Library Setup**:
   - For Python: Use `python-pptx` (requires `pip install python-pptx`).
   - For Node: Use `pptxgenjs` (requires `npm install pptxgenjs`).
3. **Scripting**:
   - Generate a temporary script that uses the chosen library to build the slide deck.
   - Make sure to use standard slide layouts (e.g., `0` for title slide, `1` for title and content in `python-pptx`).
4. **Execution & Cleanup**: Run the script to produce the `.pptx`. Notify the user and remove the temporary script if desired.

## Resources
- Documentation for `python-pptx`: https://python-pptx.readthedocs.io/
- Documentation for `pptxgenjs`: https://gitbrent.github.io/PptxGenJS/
