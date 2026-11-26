//! The shared-string table. Small tables are parsed eagerly exactly as
//! before; a table past the spill thresholds stops being an in-memory
//! `Vec<SharedString>` and instead lands in the session's cache directory
//! as a memory-mapped file with a byte-range index, each `<si>` decoded
//! on first use.

use std::borrow::Cow;
use std::collections::VecDeque;

use super::*;

/// Decompressed `sharedStrings.xml` past this size spills to the mmap
/// store. 16 MiB of XML is roughly 32 MiB of `SharedString` headers alone
/// (48 bytes each) plus the text, held for the whole session.
pub(crate) const SHARED_STRINGS_SPILL_BYTES: u64 = 16 * 1024 * 1024;
/// Distinct `<si>` entries past this count spill even when the XML is
/// small: millions of near-empty strings still cost 48+ bytes of table
/// each, and tiny entries make the byte threshold unreachable.
pub(crate) const SHARED_STRINGS_SPILL_ENTRIES: u64 = 200_000;
/// Decoded entries kept by the mmap store's LRU; a viewport re-read or a
/// filter over one column touches a small working set repeatedly.
const SHARED_STRINGS_CACHE_ENTRIES: usize = 4096;
const SHARED_STRINGS_PATH: &str = "xl/sharedStrings.xml";

/// The session's shared-string table. `get` is the single consumer
/// interface (worksheet indexing); everything else stays inside.
pub(crate) enum SharedStringsStore {
    InMemory(Vec<SharedString>),
    #[cfg(not(target_family = "wasm"))]
    Mapped(mapped::MappedSharedStrings),
}

impl SharedStringsStore {
    /// The string at shared-table index `index`, or None for a stale index
    /// (which degrades to a valueless styled cell, as before).
    pub(crate) fn get(&self, index: usize) -> Result<Option<Cow<'_, SharedString>>, SidecarError> {
        match self {
            Self::InMemory(strings) => Ok(strings.get(index).map(Cow::Borrowed)),
            #[cfg(not(target_family = "wasm"))]
            Self::Mapped(store) => Ok(store.get(index)?.map(Cow::Owned)),
        }
    }

    #[cfg(test)]
    pub(crate) fn is_mapped(&self) -> bool {
        #[cfg(target_family = "wasm")]
        {
            false
        }
        #[cfg(not(target_family = "wasm"))]
        {
            matches!(self, Self::Mapped(_))
        }
    }
}

/// Reads `xl/sharedStrings.xml` into the store. Past either spill
/// threshold the entry is decompressed into `spill_directory` and served
/// from an mmap-backed lazy index instead of a resident `Vec`; below them
/// the eager parse is byte-for-byte the code that always ran.
pub(crate) fn read_shared_strings(
    archive: &mut ZipArchive<File>,
    colors: &ColorContext,
    spill_directory: &Path,
) -> Result<SharedStringsStore, SidecarError> {
    // WebAssembly targets have no mmap: the eager path is the only one.
    #[cfg(not(target_family = "wasm"))]
    {
        if zip_entry(archive, SHARED_STRINGS_PATH).is_ok() {
            let scale = shared_strings_scale(archive)?;
            // `uniqueCount` is the list length the threshold means; writers
            // that omit it get an exact streaming count instead of a guess.
            let entries = match scale.unique_count {
                Some(entries) => entries,
                None => count_shared_string_entries(archive)?,
            };
            if scale.declared_bytes > SHARED_STRINGS_SPILL_BYTES
                || entries > SHARED_STRINGS_SPILL_ENTRIES
            {
                return mapped::build(archive, colors, spill_directory);
            }
        }
    }
    parse_shared_strings_into_memory(archive, colors)
}

/// Size signals available before anything is materialised: the declared
/// decompressed length from the zip directory and the `uniqueCount` the
/// `<sst>` root carries.
struct SharedStringsScale {
    declared_bytes: u64,
    unique_count: Option<u64>,
}

fn shared_strings_scale(archive: &mut ZipArchive<File>) -> Result<SharedStringsScale, SidecarError> {
    let entry = zip_entry(archive, SHARED_STRINGS_PATH)?;
    let declared_bytes = entry.size();
    let mut reader = Reader::from_reader(BufReader::new(entry));
    let mut buffer = Vec::new();
    loop {
        match reader.read_event_into(&mut buffer)? {
            Event::Start(element) if element.local_name().as_ref() == b"sst" => {
                let unique_count = attribute_value(&reader, &element, b"uniqueCount")?
                    .and_then(|value| value.parse::<u64>().ok());
                return Ok(SharedStringsScale {
                    declared_bytes,
                    unique_count,
                });
            }
            Event::Eof => {
                return Ok(SharedStringsScale {
                    declared_bytes,
                    unique_count: None,
                })
            }
            _ => {}
        }
        buffer.clear();
    }
}

/// Exact `<si>` count for tables whose root declares no `uniqueCount`.
fn count_shared_string_entries(archive: &mut ZipArchive<File>) -> Result<u64, SidecarError> {
    let entry = zip_entry(archive, SHARED_STRINGS_PATH)?;
    let mut reader = Reader::from_reader(BufReader::new(entry));
    let mut buffer = Vec::new();
    let mut count = 0u64;
    loop {
        match reader.read_event_into(&mut buffer)? {
            Event::Start(element) | Event::Empty(element)
                if element.local_name().as_ref() == b"si" =>
            {
                count += 1;
            }
            Event::Eof => return Ok(count),
            _ => {}
        }
        buffer.clear();
    }
}

fn parse_shared_strings_into_memory(
    archive: &mut ZipArchive<File>,
    colors: &ColorContext,
) -> Result<SharedStringsStore, SidecarError> {
    let Ok(entry) = zip_entry(archive, SHARED_STRINGS_PATH) else {
        return Ok(SharedStringsStore::InMemory(Vec::new()));
    };
    let mut reader = Reader::from_reader(BufReader::new(entry));
    let mut buffer = Vec::new();
    let mut strings = Vec::new();
    let mut accumulator = SharedStringAccumulator::default();
    loop {
        let event = reader.read_event_into(&mut buffer)?;
        if matches!(event, Event::Eof) {
            break;
        }
        if let Some(string) = accumulator.event(&reader, event, colors)? {
            strings.push(string);
        }
        buffer.clear();
    }
    Ok(SharedStringsStore::InMemory(strings))
}

/// Event state for one `<si>` element. Driven by the eager whole-file loop
/// and by the mmap store's single-element decode alike, so both paths share
/// one definition of what a shared string is (phonetic runs filtered, rich
/// runs qualified, `_xHHHH_` escapes and line endings normalized).
#[derive(Default)]
struct SharedStringAccumulator {
    current: String,
    runs: Vec<RichRun>,
    current_run: Option<RichRun>,
    in_text: bool,
    text_preserve: bool,
    text_node: String,
    in_phonetic: bool,
}

impl SharedStringAccumulator {
    /// One XML event of an `<si>` element. Returns the finished string when
    /// the element's `End` arrives.
    fn event<R: std::io::BufRead>(
        &mut self,
        reader: &Reader<R>,
        event: Event<'_>,
        colors: &ColorContext,
    ) -> Result<Option<SharedString>, SidecarError> {
        match event {
            Event::Start(element) if element.local_name().as_ref() == b"si" => {
                self.current.clear();
                self.runs.clear();
                self.current_run = None;
            }
            Event::Start(element) if element.local_name().as_ref() == b"r" => {
                self.current_run = Some(RichRun::default());
            }
            // Phonetic guide text (<rPh><t>…</t></rPh>) is ruby annotation,
            // not cell content.
            Event::Start(element) if element.local_name().as_ref() == b"rPh" => {
                self.in_phonetic = true;
            }
            Event::End(element) if element.local_name().as_ref() == b"rPh" => {
                self.in_phonetic = false;
            }
            Event::Start(element) | Event::Empty(element) if self.current_run.is_some() => {
                if element.local_name().as_ref() == b"t" {
                    self.in_text = true;
                    self.text_preserve = preserves_space(reader, &element)?;
                    self.text_node.clear();
                } else if let Some(run) = self.current_run.as_mut() {
                    apply_run_property(run, reader, &element, colors)?;
                }
            }
            Event::Start(element) if element.local_name().as_ref() == b"t" => {
                self.in_text = !self.in_phonetic;
                self.text_preserve = preserves_space(reader, &element)?;
                self.text_node.clear();
            }
            Event::Text(text) if self.in_text => {
                self.text_node.push_str(&decode_text(&text)?);
            }
            Event::CData(text) if self.in_text => {
                self.text_node.push_str(&decode_cdata(&text)?);
            }
            Event::GeneralRef(reference) if self.in_text => {
                self.text_node.push_str(&general_ref_text(&reference)?);
            }
            Event::End(element) if element.local_name().as_ref() == b"t" => {
                if self.in_text {
                    let text = text_node_content(
                        std::mem::take(&mut self.text_node),
                        self.text_preserve,
                    );
                    self.current.push_str(&text);
                    if let Some(run) = &mut self.current_run {
                        run.text.push_str(&text);
                    }
                }
                self.in_text = false;
            }
            Event::End(element) if element.local_name().as_ref() == b"r" => {
                if let Some(run) = self.current_run.take() {
                    self.runs.push(run);
                }
            }
            Event::End(element) if element.local_name().as_ref() == b"si" => {
                return Ok(Some(self.finish()));
            }
            _ => {}
        }
        Ok(None)
    }

    fn finish(&mut self) -> SharedString {
        let mut finished = std::mem::take(&mut self.runs);
        for run in &mut finished {
            normalize_cell_text(&mut run.text);
        }
        let mut text = std::mem::take(&mut self.current);
        normalize_cell_text(&mut text);
        SharedString {
            text,
            runs: qualify_runs(finished),
        }
    }
}

/// The mmap-backed store: the spilled XML, one byte range per `<si>`, and a
/// small LRU of decoded entries.
#[cfg(not(target_family = "wasm"))]
mod mapped {
    use super::*;
    use memmap2::Mmap;

    /// One `<si>` element's byte range in the spilled file, `[start, end)`
    /// covering the whole element including its tags.
    #[derive(Debug)]
    struct SharedStringMeta {
        start: u64,
        end: u64,
    }

    pub(crate) struct MappedSharedStrings {
        data: Mmap,
        metas: Vec<SharedStringMeta>,
        /// Run colours resolve against the workbook palette; the eager path
        /// had it at parse time, the lazy path keeps a copy.
        colors: ColorContext,
        cache: Mutex<SharedStringCache>,
    }

    /// Spills the entry, maps it and pre-scans the `<si>` byte ranges.
    pub(super) fn build(
        archive: &mut ZipArchive<File>,
        colors: &ColorContext,
        spill_directory: &Path,
    ) -> Result<SharedStringsStore, SidecarError> {
        let mut entry = zip_entry(archive, SHARED_STRINGS_PATH)?;
        let path = spill_directory.join("sharedStrings.xml");
        let mut writer = BufWriter::new(File::create(&path)?);
        // Same inflation guard the metadata readers use, with the spill
        // threshold as the floor: a declared size under it may simply be a
        // lying writer on a many-tiny-entries table, while anything past
        // min(declared, MAX_EXTRACTED_ENTRY_BYTES) is a bomb, not a table.
        let declared = entry.size().max(SHARED_STRINGS_SPILL_BYTES);
        copy_entry_bounded(
            &mut entry,
            declared,
            crate::archive::MAX_EXTRACTED_ENTRY_BYTES,
            &mut writer,
        )?;
        writer.flush()?;
        let file = File::open(&path)?;
        // SAFETY: nothing writes the file after the flush above; it is only
        // read (here and on the indexing threads) and unlinked when the
        // session closes, after the mapping threads have joined.
        let data = unsafe { Mmap::map(&file)? };
        let metas = scan_shared_string_ranges(&data)?;
        Ok(SharedStringsStore::Mapped(MappedSharedStrings {
            data,
            metas,
            colors: colors.clone(),
            cache: Mutex::new(SharedStringCache::new(SHARED_STRINGS_CACHE_ENTRIES)),
        }))
    }

    impl MappedSharedStrings {
        /// Decodes the entry at `index` on demand; the LRU absorbs repeated
        /// hits (a column scan re-reads the same handful of strings).
        pub(super) fn get(&self, index: usize) -> Result<Option<SharedString>, SidecarError> {
            let Some(meta) = self.metas.get(index) else {
                return Ok(None);
            };
            let mut cache = self
                .cache
                .lock()
                .map_err(|_| SidecarError::Io("Shared string cache lock was poisoned.".into()))?;
            if let Some(cached) = cache.get(index) {
                return Ok(Some(cached.clone()));
            }
            let slice = self
                .data
                .get(meta.start as usize..meta.end as usize)
                .ok_or_else(|| {
                    SidecarError::Workbook("Shared string range is out of bounds.".into())
                })?;
            let decoded = decode_shared_string_at(slice, &self.colors)?;
            cache.insert(index, decoded.clone());
            Ok(Some(decoded))
        }
    }

    /// Records every `<si>` element's byte range in one streaming pass.
    /// `buffer_position` before a read is the event's first byte and after
    /// it the event's last, so Start/End positions bracket the element.
    /// A self-closing `<si/>` counts as an entry here (spec order), where
    /// the eager parse skips it — Excel never writes one, so only tables
    /// over the spill threshold ever see the difference.
    fn scan_shared_string_ranges(data: &[u8]) -> Result<Vec<SharedStringMeta>, SidecarError> {
        let mut reader = Reader::from_reader(data);
        let mut buffer = Vec::new();
        let mut metas = Vec::new();
        let mut open: Option<u64> = None;
        loop {
            let start = reader.buffer_position();
            match reader.read_event_into(&mut buffer)? {
                Event::Start(element) if element.local_name().as_ref() == b"si" => {
                    open = Some(start);
                }
                Event::Empty(element) if element.local_name().as_ref() == b"si" => {
                    metas.push(SharedStringMeta {
                        start,
                        end: reader.buffer_position(),
                    });
                }
                Event::End(element) if element.local_name().as_ref() == b"si" => {
                    if let Some(start) = open.take() {
                        metas.push(SharedStringMeta {
                            start,
                            end: reader.buffer_position(),
                        });
                    }
                }
                Event::Eof => break,
                _ => {}
            }
            buffer.clear();
        }
        Ok(metas)
    }

    /// Decodes one `<si>` element from its slice with the same event logic
    /// the eager parse uses. (Like every other part reader here, the lazy
    /// path assumes UTF-8; a spilled non-UTF-8 table was already unreadable
    /// for the metadata parts around it.)
    fn decode_shared_string_at(
        slice: &[u8],
        colors: &ColorContext,
    ) -> Result<SharedString, SidecarError> {
        let mut reader = Reader::from_reader(slice);
        let mut buffer = Vec::new();
        let mut accumulator = SharedStringAccumulator::default();
        let mut decoded = None;
        loop {
            let event = reader.read_event_into(&mut buffer)?;
            if matches!(event, Event::Eof) {
                break;
            }
            if let Some(string) = accumulator.event(&reader, event, colors)? {
                decoded = Some(string);
                break;
            }
            buffer.clear();
        }
        Ok(decoded.unwrap_or(SharedString {
            text: String::new(),
            runs: None,
        }))
    }

    /// LRU of decoded entries with lazy deletion: the queue holds one slot
    /// per access, and a slot whose stamp is no longer the key's newest is
    /// stale and skipped at eviction time.
    struct SharedStringCache {
        capacity: usize,
        tick: u64,
        entries: HashMap<usize, (u64, SharedString)>,
        order: VecDeque<(usize, u64)>,
    }

    impl SharedStringCache {
        fn new(capacity: usize) -> Self {
            Self {
                capacity,
                tick: 0,
                entries: HashMap::new(),
                order: VecDeque::new(),
            }
        }

        fn get(&mut self, index: usize) -> Option<&SharedString> {
            let tick = self.tick;
            self.tick += 1;
            let (stamp, _) = self.entries.get_mut(&index)?;
            *stamp = tick;
            self.order.push_back((index, tick));
            // A hit-only workload never evicts, so stale slots would pile
            // up; compact back to one slot per live entry now and then.
            if self.order.len() > self.capacity * 4 {
                self.order
                    .retain(|(index, stamp)| {
                        self.entries.get(index).is_some_and(|(current, _)| current == stamp)
                    });
            }
            self.entries.get(&index).map(|(_, value)| value)
        }

        fn insert(&mut self, index: usize, value: SharedString) {
            while self.entries.len() >= self.capacity {
                let Some((candidate, stamp)) = self.order.pop_front() else {
                    break;
                };
                if self
                    .entries
                    .get(&candidate)
                    .is_some_and(|(current, _)| *current == stamp)
                {
                    self.entries.remove(&candidate);
                    break;
                }
            }
            let tick = self.tick;
            self.tick += 1;
            self.order.push_back((index, tick));
            self.entries.insert(index, (tick, value));
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        /// The queue-based LRU must evict by recency, not insertion order.
        #[test]
        fn shared_string_cache_evicts_by_recency() {
            let string = |index: usize| SharedString {
                text: format!("s{index}"),
                runs: None,
            };
            let mut cache = SharedStringCache::new(4);
            for index in 0..4usize {
                cache.insert(index, string(index));
            }
            // Refreshing 0 makes 1 the least recently used, so the next
            // insert evicts 1 while the touched entry survives.
            assert!(cache.get(0).is_some());
            cache.insert(4, string(4));
            assert!(cache.get(0).is_some(), "recently touched entry survives");
            assert!(cache.get(1).is_none(), "least recently used entry was evicted");
            assert!(cache.get(4).is_some());
            assert!(cache.entries.len() <= 4);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A real-scale table over the entry threshold (no `uniqueCount`, so
    /// the exact counting fallback decides) spills and decodes every entry
    /// identically to the eager parse.
    #[test]
    fn mapped_store_decodes_entries_lazily() {
        let entries = (SHARED_STRINGS_SPILL_ENTRIES + 1) as usize;
        let mut xml = String::from(
            r#"<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="1">"#,
        );
        for index in 0..entries {
            xml.push_str(&format!("<si><t>item {index}</t></si>"));
        }
        xml.push_str("</sst>");
        let (_dir, path) = crate::tests::open_fixture(&[("xl/sharedStrings.xml", xml.as_str())]);
        let mut archive = ZipArchive::new(File::open(&path).unwrap()).unwrap();
        let spill = tempfile::tempdir().unwrap();
        let store =
            read_shared_strings(&mut archive, &ColorContext::default(), spill.path()).unwrap();
        assert!(store.is_mapped());
        for index in [0usize, 1, 700, entries / 2, entries - 1] {
            let string = store.get(index).unwrap().expect("entry must exist");
            assert_eq!(string.text, format!("item {index}"));
            assert!(string.runs.is_none());
        }
        assert!(store.get(entries).unwrap().is_none());
        // Re-reads come through the LRU.
        assert_eq!(store.get(0).unwrap().unwrap().text, "item 0");
    }
}
