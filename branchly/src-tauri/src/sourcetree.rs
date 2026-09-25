//! Sourcetree (Windows) depo listesini içe aktarma.
//!
//! Sourcetree yer imlerini %LOCALAPPDATA%\Atlassian\SourceTree\bookmarks.xml dosyasında
//! tutar: <ArrayOfTreeViewNode> altında klasörler (BookmarkFolderNode, <Children> içerir)
//! ve depolar (BookmarkNode, <Name> ve <Path> içerir). Açık sekmeler ise aynı klasördeki
//! opentabs.xml dosyasında yol listesi olarak bulunur.
//! Bu modül dosyaları yalnızca okur; Sourcetree'nin kendi verisine dokunmaz.

use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Serialize, Debug, Clone)]
pub struct StRepo {
    pub name: String,
    pub path: String,
    /// Sourcetree'deki klasör (grup) adı
    pub folder: Option<String>,
    /// Klasör diskte hâlâ var mı
    pub exists: bool,
    /// Git deposu mu (Sourcetree Mercurial depolarını da tutabilir)
    pub is_git: bool,
    /// Sourcetree'de açık sekme olarak duruyor muydu
    pub open_tab: bool,
}

pub fn sourcetree_dir() -> Option<PathBuf> {
    if let Ok(d) = std::env::var("BRANCHLY_SOURCETREE_DIR") {
        return Some(PathBuf::from(d));
    }
    std::env::var("LOCALAPPDATA").ok().map(|l| PathBuf::from(l).join("Atlassian").join("SourceTree"))
}

pub fn find_repos() -> Vec<StRepo> {
    let Some(dir) = sourcetree_dir() else { return vec![] };
    let Ok(xml) = std::fs::read_to_string(dir.join("bookmarks.xml")) else { return vec![] };
    let tabs = std::fs::read_to_string(dir.join("opentabs.xml")).map(|t| parse_open_tabs(&t)).unwrap_or_default();
    let mut repos = parse_bookmarks(&xml);
    for r in repos.iter_mut() {
        let p = Path::new(&r.path);
        r.exists = p.is_dir();
        r.is_git = p.join(".git").exists();
        r.open_tab = tabs.iter().any(|t| same_path(t, &r.path));
    }
    repos
}

fn same_path(a: &str, b: &str) -> bool {
    let norm = |s: &str| s.trim().trim_end_matches(['\\', '/']).replace('/', "\\").to_lowercase();
    norm(a) == norm(b)
}

pub fn parse_bookmarks(xml: &str) -> Vec<StRepo> {
    // BOM ve olası kodlama başlığı sorunlarına karşı temizle
    let xml = xml.trim_start_matches('\u{feff}');
    let Ok(doc) = roxmltree::Document::parse(xml) else { return vec![] };
    let mut out = vec![];
    for node in doc.descendants().filter(|n| n.has_tag_name("TreeViewNode")) {
        let child_text = |tag: &str| {
            node.children()
                .find(|c| c.has_tag_name(tag))
                .and_then(|c| c.text())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
        };
        let Some(path) = child_text("Path") else { continue };
        let name = child_text("Name").unwrap_or_else(|| {
            Path::new(&path).file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| path.clone())
        });
        // En yakın üst klasör düğümünün adı
        let folder = node
            .ancestors()
            .skip(1)
            .filter(|a| a.has_tag_name("TreeViewNode"))
            .find_map(|a| a.children().find(|c| c.has_tag_name("Name")).and_then(|c| c.text()).map(|s| s.trim().to_string()));
        if out.iter().any(|r: &StRepo| same_path(&r.path, &path)) {
            continue;
        }
        out.push(StRepo { name, path, folder, exists: false, is_git: false, open_tab: false });
    }
    out
}

fn parse_open_tabs(xml: &str) -> Vec<String> {
    let xml = xml.trim_start_matches('\u{feff}');
    let Ok(doc) = roxmltree::Document::parse(xml) else { return vec![] };
    doc.descendants()
        .filter(|n| n.has_tag_name("string"))
        .filter_map(|n| n.text().map(|s| s.trim().to_string()))
        .filter(|s| !s.is_empty())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"<?xml version="1.0"?>
<ArrayOfTreeViewNode xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <TreeViewNode xsi:type="BookmarkFolderNode">
    <Level>0</Level>
    <IsExpanded>true</IsExpanded>
    <IsLeaf>false</IsLeaf>
    <Name>Acme</Name>
    <Children>
      <TreeViewNode xsi:type="BookmarkNode">
        <Level>1</Level>
        <IsExpanded>false</IsExpanded>
        <IsLeaf>true</IsLeaf>
        <Name>musteri-portali</Name>
        <Children />
        <Path>C:\Projeler\musteri-portali</Path>
        <RepoType>Git</RepoType>
      </TreeViewNode>
      <TreeViewNode xsi:type="BookmarkNode">
        <Level>1</Level>
        <Name>odeme-servisi</Name>
        <Children />
        <Path>C:\Projeler\odeme-servisi</Path>
        <RepoType>Git</RepoType>
      </TreeViewNode>
    </Children>
  </TreeViewNode>
  <TreeViewNode xsi:type="BookmarkNode">
    <Level>0</Level>
    <Name>dotfiles</Name>
    <Children />
    <Path>D:\dotfiles</Path>
    <RepoType>Git</RepoType>
  </TreeViewNode>
</ArrayOfTreeViewNode>"#;

    #[test]
    fn parses_folders_and_repos() {
        let r = parse_bookmarks(SAMPLE);
        assert_eq!(r.len(), 3);
        assert_eq!(r[0].name, "musteri-portali");
        assert_eq!(r[0].folder.as_deref(), Some("Acme"));
        assert_eq!(r[1].path, "C:\\Projeler\\odeme-servisi");
        assert_eq!(r[2].folder, None);
    }

    #[test]
    fn parses_open_tabs() {
        let t = parse_open_tabs(r#"<?xml version="1.0"?><ArrayOfString><string>C:\Projeler\musteri-portali</string></ArrayOfString>"#);
        assert_eq!(t, vec!["C:\\Projeler\\musteri-portali"]);
        assert!(same_path("c:/projeler/musteri-portali/", "C:\\Projeler\\musteri-portali"));
    }
}
