# Token Wars: measure your own AI instructions

This small program shows what your AI instructions cost, one question at a time. It runs on your own computer. You bring two things: the instructions your AI gets before every question (sometimes called a system prompt) and your Anthropic API key.

## What you need

1. **A Mac or Windows computer.**
2. **Node.js**, a free program that runs Token Wars. Go to [nodejs.org](https://nodejs.org), click the big **LTS** download button, and install it like any other app. You only do this once.
3. **An Anthropic API key.** Sign in at [console.anthropic.com](https://console.anthropic.com), open **API Keys**, and click **Create Key**. Copy it; it starts with `sk-ant-`. Every question you ask is billed to this key, usually a fraction of a cent.

## Start it

1. Unzip the Token Wars folder anywhere, for example on your Desktop.
2. **Mac:** double-click `start.command`. The first time, your Mac will probably say it "cannot be opened" or "cannot verify the developer". Click **Done** (or **OK**), open **System Settings**, go to **Privacy & Security**, scroll down, and click **Open Anyway** next to the message about `start.command`. Confirm with your password, then double-click `start.command` again.
   If that button isn't there: open the **Terminal** app, type `cd ` (with a space), drag the Token Wars folder onto the Terminal window, press **Enter**, then type `node giveaway/serve.js --open` and press **Enter**.
   **Windows:** double-click `start.bat`. If Windows shows a blue "protected your PC" box, click **More info**, then **Run anyway**.
3. A black window opens and your browser opens Token Wars. Keep the black window open while you use it. If the browser doesn't open by itself, copy the address shown in the black window (it looks like `http://127.0.0.1:4174/giveaway/`) into your browser.

### Starting it with Cursor, Codex, or Claude Code

Open this folder in the tool and paste the setup instructions from the Token Wars session. If you are the AI tool reading this: start Token Wars so it keeps running in its own window. On a Mac, run `open start.command` from this folder. On Windows, run `start start.bat`. If neither works, run `node giveaway/serve.js --open` from this folder in a terminal that stays open. It needs Node.js 18 or newer. Do not change any files, and never ask for or handle the API key: the person pastes it into the Token Wars page.

## Use it

1. On the **Your setup** screen, paste your API key and click **Use key**. The box empties straight away. That's expected: the key is now held by the page, not shown.
2. Paste your AI's instructions.
3. Optionally paste reference pages (put a line with just `---` between pages) and a few sample questions, one per line.
4. Click **Use these and go to Token Cost**, then type a question and click **Ask**. Five boxes show what that answer cost; **LLM comparison** keeps a running list of every question you ask, with its settings, cost without caching (TTL), cost with caching (CTC) and percent saved.
5. Try the dropdowns under the question. Hover over any **(i)** for a one-line explanation. The **«** button hides the menu on the left; **»** brings it back.
   - **AI model** switches between Claude Sonnet 5, Claude Opus 5.5 and Claude Fable 5.1, so you can see what the same question costs on each.
   - **Effort** sets how hard the AI thinks before answering. More effort means more output tokens, and output is the expensive part.
   - **Context** shows what the answer would cost with 300K or 1M tokens of documents attached. Nothing extra is sent; it is worked out from the price list.
   - Your instructions are always saved for reuse, so from the second question on you pay a fraction of the price for them. **How to Cache** shows how to do the same in your own project.

Press the number keys **1** to **6** to jump between screens, and **F** for full screen.

## Your key and your prompt stay private

- Your key is kept in the page's memory only. It is never saved to a file, never stored in your browser, and never shown on screen.
- Your key and prompt are sent only to Anthropic (`api.anthropic.com`), and nowhere else. There is no tracking or analytics.
- Closing or reloading the tab forgets everything, including the key. You'll paste it again next time.
- For extra safety, create a separate key just for this and delete it in the Anthropic Console when you're done.
- Token Wars contains no instructions, data or questions of its own. Everything it measures is what you paste in.

## Stop it

Close the browser tab, then close the black window (or click in it and press **Ctrl+C**).

## If something goes wrong

- **"Key not accepted":** copy the key again from the Anthropic Console, making sure you got the whole thing.
- **"Too many requests" or "AI service is busy":** wait a few seconds and try again.
- **"Too short for this AI to reuse":** reuse only works once your instructions and reference pages pass a minimum size. That is about 800 words for Claude Sonnet 5 and about 400 for Claude Opus 5.5 and Claude Fable 5.1.
- **Nothing opens / "Node.js is not installed":** install Node.js from nodejs.org, then start again.
