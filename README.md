# Arkhon Memory - Persistent Character Memory for SillyTavern

> **🧪 Currently in Beta** | Functional but under active development. [Join beta program for Pro features →](https://arkhon.app)

**Smart, local, permanent memory for your characters.** No more repeating yourself. No cloud uploads. Just context that actually sticks.

---

## **⚠️ Beta Status**

**The free tier is fully functional and always will be.** However, Arkhon Memory is currently in beta testing:

- ✅ **Free tier works now** - Local FAISS-based memory, fully functional
- 🧪 **Expect updates** - Active development based on user feedback
- 🐛 **Report bugs** - Help us improve by opening GitHub issues
- 🚀 **Pro tier in development** - Advanced scoring features coming soon

**Not ready for production use?** That's okay - bookmark this and come back after public launch (Dec 2024).

---

## **Why Arkhon Memory?**

Your characters forget. You tell them something important, switch chats, come back later—and it's gone.

**Arkhon Memory fixes this.**

- 💾 **Persistent** - Memories survive restarts, chat switches, even character card updates
- 🧠 **Smart recall** - Vector search finds relevant memories, not just exact matches
- 🔒 **100% local** - Nothing leaves your computer. Ever.
- 🎯 **Automatic filtering** - Only high-quality, relevant memories make it to your LLM
- ⚙️ **Zero config required** - Works out of the box, customize if you want

---

## **🚀 Quick Start**

> **Beta Note:** These instructions work for the free tier. If you encounter issues, please open a GitHub issue with details!

### **Installation**

1. **Download the extension:**
   ```bash
   git clone https://github.com/kissg96/arkhon-st.git
   ```
   
2. **Copy to SillyTavern:**
   ```
   SillyTavern/data/default-user/extensions/arkhon-st/
   ```

3. **Install dependencies:**
   ```bash
   cd SillyTavern/data/default-user/extensions/arkhon-st
   pip install -r requirements.txt
   ```
   *First install may take a few minutes (PyTorch, sentence-transformers, etc.)*

4. **Start local memory server:**
   ```bash
   python memory_server.py
   ```
   *Keep this terminal open while using SillyTavern*
   
   > **Tip:** To stop the server later, press `Ctrl+C` in the terminal

5. **Start SillyTavern** and enable "Arkhon Memory" in Extensions menu

6. **Look for `[ArkhonMemory]` messages** in the console to confirm it's working

**That's it.** Your characters now have permanent memory.

---

## **How It Works**

Every message is automatically:
1. **Embedded** - Converted to vectors for semantic search
2. **Stored** - Saved locally in your character's memory folder
3. **Recalled** - Retrieved when contextually relevant

**Memory storage:**
```
SillyTavern/data/default-user/extensions/arkhon-st/arkhon_data/
├── <user_id>/
│   ├── <character_1>/
│   ├── <character_2>/
│   └── ...
```

**All data stays on your machine.** No cloud. No tracking. No uploads.

---

## **🎯 Pro Tier - Early Adopter Program**

The free tier (what you're using now) is **fully functional and will always be free.**

We're building a **Pro tier** with:
- ⚡ **Advanced scoring algorithm** - Even smarter memory prioritization
- 🔥 **Server-powered processing** - Server-grade memory analysis
- 🎨 **Priority features** - Early access to new capabilities

**Early adopter pricing:** 50% off launch price, **locked in forever** for the first 100 users.

**[Join the waitlist →](https://arkhon.app)**

*Beta testers get Pro+ free forever!*

---

## **Troubleshooting**

### **"Missing dependencies" error**
```bash
pip install sentence-transformers faiss-cpu numpy torch flask flask-cors waitress
```

### **Memory not saving**
- Check that `python memory_server.py` is running
- Look for `[ArkhonMemory]` messages in ST console
- Check terminal running memory_server for errors

### **Server won't start**
- Make sure port 9000 isn't already in use
- Try restarting both the memory server and SillyTavern

### **Reset character memory**
Delete the character's folder in `arkhon_data/<user_id>/<character_name>/` and restart.

### **Still stuck?**
[Open an issue on GitHub](https://github.com/kissg96/arkhon-st/issues) with:
- What you were trying to do
- Error messages (from both ST console and memory_server terminal)
- Your OS and Python version

---

## **Contributing**

Found a bug? Have a feature idea? 

1. Check [existing issues](https://github.com/kissg96/arkhon-st/issues)
2. Open a new issue with details
3. PRs welcome for bug fixes

**Beta testers especially appreciated!** Your feedback directly shapes the product.

---

## **License**

All rights reserved. Contact author for licensing inquiries.

---

## **Support the Project**

Arkhon Memory's free tier is free forever. If you find it useful:

- ⭐ Star the repo
- Report bugs
- Share with the ST community
- [Join the Pro waitlist](https://arkhon.app) (supports development)

---

**Built with ❤️ for the SillyTavern community**

*Part of the [CATH project] - autonomous AI orchestration research.*