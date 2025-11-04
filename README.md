# **Arkhon Memory - Persistent Character Memory for SillyTavern**

> **Smart, local, permanent memory for your characters.** No more repeating yourself. No cloud uploads. Just context that actually sticks.

[![Early Adopter Program](https://img.shields.io/badge/Early_Adopter-50%25_OFF-green)](https://forms.gle/5mipaEtc66aRZamEA)

---

## **Why Arkhon Memory?**

Your characters forget. You tell them something important, switch chats, come back later—and it's gone.

**Arkhon Memory fixes this.**

- **Persistent** - Memories survive restarts, chat switches, even character card updates
- **Smart recall** - Vector search finds relevant memories, not just exact matches
- **100% local** - Nothing leaves your computer. Ever.
- **Automatic filtering** - Only high-quality, relevant memories make it to your LLM
- **Zero config required** - Works out of the box, customize if you want

---

## **Quick Start**

### **Installation**

1. **Download the extension:**
   ```bash
   git clone https://github.com/kiss96/arkhon-st.git
   ```
   
2. **Copy all files to SillyTavern folder:**
   ```
   SillyTavern/data/default-user/extensions/arkhon-st/
   ```

3. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```
   *First install may take a few minutes (PyTorch, sentence-transformers, etc.)*

4. **Start local memory_server**
    ```bash
   cd SillyTavern/data/default-user/extensions/arkhon-st
   python -m memory_server
   ```  
   Let it run in a separate terminal/powershell. To stop the server press Ctrl+C in the terminal or just close the window.

5. **Start SillyTavern**
   Start SillyTavern in a separate terminal/powershell

6. **Enable in SillyTavern:**
   - Open Extensions menu
   - Enable "Arkhon Memory"
   - Look for `[ArkhonMemory]` in the console

**That's it.** Your characters now have permanent memory.

---

## **How It Works**

Every message is automatically:
1. **Embedded** - Converted to vectors for semantic search
2. **Stored** - Saved locally in your character's memory folder into your arkhon-st directory
3. **Recalled** - Retrieved when contextually relevant

**Memory storage:**
```
SillyTavern/data/default-user/extensions/arkhon-st/memory/
├── <character_1>/
├── <character_2>/
└── global/          (optional shared memory)
```

**All data stays on your machine.** No cloud. No tracking. No uploads.

---

## **🎯 Pro Tier - Early Adopter Program**

The free tier (what you're using now) is **fully functional and will always be free.**

We're building a **Pro tier** with:
- **Advanced recall algorithm** - Even smarter memory prioritization
- **Server-powered processing** - Server-grade memory analysis
- **Priority features** - Early access to new capabilities

**Early adopter pricing:** 50% off launch price, **locked in forever** for the first 100 users.

**[Join the waitlist →](https://forms.gle/5mipaEtc66aRZamEA)**

---

### **Still stuck?**
[Open an issue on GitHub](https://github.com/kiss96/arkhon-st/issues) or join our Discord.

---

## **Contributing**

Found a bug? Have a feature idea? 

1. Check [existing issues](https://github.com/kiss96/arkhon-st/issues)
2. Open a new issue with details
3. PRs welcome for bug fixes

---

## **License**

All rights reserved. Contact author for licensing inquiries.

---

## **Support the Project**

Arkhon Memory is free and always will be. If you find it useful:

- ⭐ Star the repo
- Report bugs
- Share with the ST community
- [Join the Pro waitlist](https://forms.gle/5mipaEtc66aRZamEA) (supports development)

---

**Built with ❤️ for the SillyTavern community**

*Powered by [CATH] - autonomous AI orchestration research.*