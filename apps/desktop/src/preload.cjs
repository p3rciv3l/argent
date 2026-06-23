const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("argent", {
  loadData: () => ipcRenderer.invoke("argent:load-data"),
  transactions: (filters) => ipcRenderer.invoke("argent:transactions", filters),
  reviewTransactions: (transactionIds, status) =>
    ipcRenderer.invoke("argent:review-transactions", transactionIds, status),
  applyProposal: (proposalId) => ipcRenderer.invoke("argent:apply-proposal", proposalId)
});
