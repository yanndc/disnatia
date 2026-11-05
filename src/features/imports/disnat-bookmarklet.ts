/**
 * Favori (bookmarklet) « Envoyer à DisnatIA ».
 *
 * Le lien est exécuté **dans la page Disnat** : il lit le HTML déjà affiché (aucun identifiant
 * n'est stocké) et le poste à DisnatIA avec le jeton d'import. Le jeton est visible dans l'URL
 * du favori : l'app est mono-utilisateur derrière le verrou de site.
 */
export function buildDisnatBookmarklet(appUrl: string, token: string): string {
  const endpoint = `${appUrl.replace(/\/$/, "")}/api/portfolio/import-session/page`;
  const cacheKey = "disnatia.clientCode";
  const script = `(async()=>{
    if(!confirm("Envoyer cette page Disnat à DisnatIA ?"))return;
    const collectHtml=()=>{
      let markup=document.documentElement.outerHTML;
      document.querySelectorAll("iframe").forEach((frame)=>{
        try{
          const doc=frame.contentDocument;
          if(doc&&doc.documentElement)markup+="\\n<!-- iframe -->\\n"+doc.documentElement.outerHTML;
        }catch(_){}
      });
      return markup;
    };
    const html=collectHtml();
    const secours=()=>{
      try{
        const ta=document.createElement("textarea");
        ta.value=html;ta.style.position="fixed";ta.style.top="-9999px";
        document.body.appendChild(ta);ta.select();
        const ok=document.execCommand("copy");
        document.body.removeChild(ta);
        if(ok){alert("DisnatIA — envoi impossible. La page (HTML complet) est dans le presse-papier : colle-la dans l'onglet « Page Disnat (coller) » de DisnatIA.");return;}
      }catch(_){}
      try{
        const a=document.createElement("a");
        a.href=URL.createObjectURL(new Blob([html],{type:"text/html"}));
        a.download="disnatia-"+(new Date().toISOString().slice(0,10))+".html";
        a.click();URL.revokeObjectURL(a.href);
        alert("DisnatIA — envoi impossible. La page a été téléchargée : dépose le fichier dans l'onglet « Page Disnat (coller) » de DisnatIA.");
      }catch(e2){alert("DisnatIA — envoi impossible ("+e2.message+").");}
    };
    const askClient=()=>{
      let saved="";
      try{saved=localStorage.getItem(${JSON.stringify(cacheKey)})||"";}catch(_){}
      const answer=prompt("DisnatIA — code client Disnat à créditer (ex. 5KFZE) :",saved);
      if(!answer)return "";
      const code=answer.trim().toUpperCase();
      try{localStorage.setItem(${JSON.stringify(cacheKey)},code);}catch(_){}
      return code;
    };
    const send=(clientCode)=>fetch(${JSON.stringify(endpoint)},{
      method:"POST",
      headers:{"content-type":"application/json","x-disnat-token":${JSON.stringify(token)}},
      body:JSON.stringify({html:html,url:location.href,clientCode:clientCode||""})
    });
    try{
      let r=await send("");
      let j=await r.json().catch(()=>({}));
      if(!r.ok&&j.code==="CLIENT_REQUIRED"){
        const code=askClient();
        if(!code){alert("DisnatIA — envoi annulé : code client requis pour rattacher l'encaisse.");return;}
        r=await send(code);
        j=await r.json().catch(()=>({}));
      }
      if(r.ok){
        if(j.mode==="summary"){
          const n=${
            JSON.stringify(
              "DisnatIA — encaisse du client %client% enregistrée le %date% : %cash% $ d'encaisse, %sec% $ de titres, %total% $ au total.",
            )
          };
          const f=(v)=>new Intl.NumberFormat("fr-CA",{minimumFractionDigits:2,maximumFractionDigits:2}).format(v||0);
          alert(n.replace("%client%",j.clientCode||"").replace("%date%",j.asOfDate).replace("%cash%",f(j.cashCad)).replace("%sec%",f(j.securitiesCad)).replace("%total%",f(j.totalCad)));
          return;
        }
        const lignes=["DisnatIA — "+(j.rowsTotal??0)+" ligne(s) lues sur "+(j.accounts||[]).length+" compte(s).",
          (j.updated||0)+" compte(s) mis à jour · "+(j.duplicates||0)+" déjà à jour"+(j.errors?(" · "+j.errors+" erreur(s)"):"")];
        if(j.errorAccounts&&j.errorAccounts.length)lignes.push("",...j.errorAccounts);
        alert(lignes.join("\\n"));
      }else{
        alert("DisnatIA — "+(j.error||("erreur "+r.status)));
        if(r.status===422||r.status>=500)secours();
      }
    }catch(e){
      alert("DisnatIA — échec réseau : "+e.message);
      secours();
    }
  })();`;
  return `javascript:${script.replace(/\s+/g, " ")}`;
}
