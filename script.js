         ALLOWED_LETTERS_RU = ['А', 'В', 'Е', 'К', 'М', 'Н', 'О', 'Р', 'С', 'Т', 'У', 'Х'];
        // В британских номерах не используются I, Q, Z для исключения путаницы с цифрами
        const ALLOWED_LETTERS_UK = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y'];
        const REGIONS = [

            // Москва и МО
            '77', '97', '99', '177', '197', '199', '777', '797', '799', '977',
            '50', '90', '150', '190', '750', '790',
            // Санкт-Петербург и ЛО
            '78', '98', '178', '198', '47', '147',
            // Краснодарский край и Юг
            '23', '93', '123', '193', '323', '723', '61', '161', '761', '26', '126', '34', '134', '30', '130', '01', '101',
            // Поволжье и Урал
            '16', '116', '716', '02', '102', '702', '63', '163', '763', '52', '152', '252',
            '66', '96', '196', '74', '174', '774', '59', '159', '18', '118', '64', '164', '58', '158',
            // Сибирь и Дальний Восток
            '54', '154', '754', '24', '124', '38', '138', '55', '155', '42', '142', '72', '172', '25', '125', '725', '27', '127',
            // Центральная Россия и Северо-Запад
            '36', '136', '31', '131', '46', '48', '71', '33', '37', '76', '40', '62', '69', '39', '139', '51', '10', '29', '35'
        ];

        const STORAGE_KEY_MODE = 'autonumber_game_mode_rel1';
        const STORAGE_KEY_PROGRESS_RU = 'autonumber_game_progress_rel1';
        const STORAGE_KEY_PROGRESS_UK = 'autonumber_game_progress_uk_rel1';
        const STORAGE_KEY_THEME = 'autonumber_game_theme_rel1';
        const STORAGE_KEY_SOUND = 'autonumber_game_sound_rel1';
        const STORAGE_KEY_RULES_SEEN = 'autonumber_game_rules_seen_rel1';

        let vkBridgeReady = false;
        let isAdPlaying = false;

        // Конфигурация доступных на релизе функций (Feature Flags)
        const GAME_FEATURES = {
            enableUKMode: false,         // Кнопка смены режима RUS / UK
            enableDevTools: false,       // Тестовые кнопки разработчика снизу
            enableConsumables: false,    // Вкладка «Расходники» в Автомагазине
            enableAtlas: false,          // Вкладка «Атлас регионов» в Коллекции (прогресс всё равно копится)
            enableRewardAd: false,       // Кнопка бесплатной заправки за просмотр рекламы
            hiddenSkinIds: ['emerald', 'diplomat', 'neon', 'platinum'] // Скрытые на релизе скины знака
        };

        let gameMode = GAME_FEATURES.enableUKMode
            ? (localStorage.getItem(STORAGE_KEY_MODE) || 'ru')
            : 'ru';
        let dictionaries = {
            ru: new Set(),
            uk: new Set()
        };


        // Синтезатор звуковых эффектов на Web Audio API
        const SoundFX = (() => {
            let ctx = null;
            let enabled = localStorage.getItem(STORAGE_KEY_SOUND) !== 'off';

            function getCtx() {
                if (!enabled || isAdPlaying || document.hidden) return null;
                if (!ctx) {
                    const AudioCtx = window.AudioContext || window.webkitAudioContext;
                    if (AudioCtx) ctx = new AudioCtx();
                }
                if (ctx && ctx.state === 'suspended') {
                    ctx.resume().catch(() => {});
                }
                return ctx;
            }

            function playTone(freq, type, duration, volume = 0.08, delay = 0, endFreq = null) {
                const audio = getCtx();
                if (!audio) return;

                const now = audio.currentTime + delay;
                const osc = audio.createOscillator();
                const gain = audio.createGain();

                osc.type = type;
                osc.frequency.setValueAtTime(freq, now);
                if (endFreq) {
                    osc.frequency.exponentialRampToValueAtTime(endFreq, now + duration);
                }

                gain.gain.setValueAtTime(0.0001, now);
                gain.gain.linearRampToValueAtTime(volume, now + 0.012);
                gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

                osc.connect(gain);
                gain.connect(audio.destination);

                osc.start(now);
                osc.stop(now + duration + 0.02);
            }

            return {
                isEnabled: () => enabled,
                toggle: () => {
                    enabled = !enabled;
                    localStorage.setItem(STORAGE_KEY_SOUND, enabled ? 'on' : 'off');
                    if (enabled) playTone(580, 'sine', 0.09, 0.07);
                    return enabled;
                },
                // Тихий клик при наборе буквы
                keyTick: () => playTone(320, 'triangle', 0.03, 0.025),
                // Подсветка очередной буквы номера в треке
                pillMatch: (step) => playTone(440 + step * 110, 'sine', 0.09, 0.055),
                // Победный аккорд
                success: (withStreak = false) => {
                    playTone(523.25, 'sine', 0.16, 0.08, 0);      // C5
                    playTone(659.25, 'sine', 0.18, 0.08, 0.07);   // E5
                    playTone(783.99, 'sine', 0.26, 0.09, 0.14);   // G5
                    if (withStreak) {
                        playTone(1046.5, 'triangle', 0.32, 0.08, 0.22); // C6 за серию
                    }
                },
                // Звон при выпадении красивого золотого номера
                golden: () => {
                    playTone(987.77, 'sine', 0.22, 0.07, 0.05);   // B5
                    playTone(1318.5, 'sine', 0.35, 0.07, 0.13);   // E6
                },
                // Ошибка / опечатка
                error: () => {
                    playTone(190, 'sawtooth', 0.12, 0.045, 0, 150);
                    playTone(155, 'sawtooth', 0.16, 0.045, 0.11, 125);
                },
                // Переворот / пропуск номера
                flip: () => playTone(260, 'triangle', 0.11, 0.05, 0, 140),
                // Подсказка и открытие новой буквы
                hint: () => {
                    playTone(660, 'sine', 0.11, 0.06, 0);
                    playTone(880, 'sine', 0.18, 0.06, 0.08);
                }
            };
        })();


        const DB_NAME = 'AutonumberDictDB';
        const DB_STORE = 'dictionaryStore';

        function getDictDBKey(mode = gameMode) {
            return mode === 'uk' ? 'english_words_set' : 'russian_words_set';
        }

        function getProgressStorageKey(mode = gameMode) {
            return mode === 'uk' ? STORAGE_KEY_PROGRESS_UK : STORAGE_KEY_PROGRESS_RU;
        }

        function getActiveDictionary() {
            return dictionaries[gameMode];
        }

        let currentPlate = {
            letters: ['А', 'А', 'А'],
            digits: '777',
            region: '77'
        };

        //Магазин
        const PLATE_SKINS = [
            {
                id: 'default',
                name: 'Классический ГОСТ',
                desc: 'Стандартный заводской знак',
                price: 0,
                previewClass: 'preview-default',
                plateClass: ''
            },
            {
                id: 'chrome',
                name: 'Хром-пакет',
                desc: 'Металлическая рамка и серебристый отлив',
                price: 400,
                previewClass: 'preview-chrome',
                plateClass: 'skin-chrome'
            },
            {
                id: 'carbon',
                name: 'Карбон Спорт',
                desc: 'Карбоновая текстура и красный кант',
                price: 1000,
                previewClass: 'preview-carbon',
                plateClass: 'skin-carbon'
            },
            {
                id: 'ussr',
                name: 'Ретро СССР',
                desc: 'Легендарный чёрный советский номер',
                price: 2500,
                previewClass: 'preview-ussr',
                plateClass: 'skin-ussr'
            },
            {
                id: 'police',
                name: 'Спецсерия МВД',
                desc: 'Синий фон с белыми символами',
                price: 5000,
                previewClass: 'preview-police',
                plateClass: 'skin-police'
            },
            {
                id: 'gold',
                name: 'Золотой слиток',
                desc: 'Премиальный золотой корпус номера',
                price: 10000,
                previewClass: 'preview-gold',
                plateClass: 'skin-gold'
            },
            {
                id: 'emerald',
                name: 'Изумруд (ФСО)',
                desc: 'Тёмно-зелёный металлик с изумрудным кантом',
                price: 18000,
                previewClass: 'preview-emerald',
                plateClass: 'skin-emerald'
            },
            {
                id: 'diplomat',
                name: 'Красная дипмиссия',
                desc: 'Официальный красный дипломатический знак',
                price: 30000,
                previewClass: 'preview-diplomat',
                plateClass: 'skin-diplomat'
            },
            {
                id: 'neon',
                name: 'Кибер-неон',
                desc: 'Чёрный корпус с бирюзовой неоновой подсветкой',
                price: 50000,
                previewClass: 'preview-neon',
                plateClass: 'skin-neon'
            },
            {
                id: 'platinum',
                name: 'Платиновый VIP',
                desc: 'Эксклюзивный платиновый слиток с ледяным отливом',
                price: 75000,
                previewClass: 'preview-platinum',
                plateClass: 'skin-platinum'
            }
        ];

        let historyList = [];
        let collectionList = [];
        let ownedSkins = ['default'];
        let equippedSkin = 'default';
        let activeShopTab = 'skins'; // 'skins' | 'consumables'
        let streakShields = 0;       // Кол-во страховок серии
        let goldenMagnetCharges = 0; // Оставшиеся ходы магнита красивых номеров
        let orderedRegionCode = null;// Заказанный код региона на следующий номер
        let usedWordsSet = new Set();
        let score = 0;
        let streak = 0;

        let activeHistoryTab = 'all';
        let activeCollectionTab = 'plates'; // 'plates' | 'atlas'
        let collectionSearchQuery = '';
        let currentHintWord = null;

        let isFreeHintActive = false;
        let hintRevealedIndices = new Set();
        let hintTimerInterval = null;
        let hintSecondsLeft = 60;
        let lastMatchedPillsCount = 0;

        function getActiveMultiplier(isBeautiful) {
            let mult = 0;
            if (isBeautiful) mult += 2;
            if (isFreeHintActive) mult += 2;
            return mult > 0 ? mult : 1;
        }


        // DOM элементы
        // Справочник регионов: название и имя файла в папке regions/ (без расширения .jpg)
        const REGION_INFO = {
            // Москва и МО
            '77': { name: 'г. Москва', img: '77' }, '97': { name: 'г. Москва', img: '77' },
            '99': { name: 'г. Москва', img: '77' }, '177': { name: 'г. Москва', img: '77' },
            '197': { name: 'г. Москва', img: '77' }, '199': { name: 'г. Москва', img: '77' },
            '777': { name: 'г. Москва', img: '77' }, '797': { name: 'г. Москва', img: '77' },
            '799': { name: 'г. Москва', img: '77' }, '977': { name: 'г. Москва', img: '77' },
            '50': { name: 'Московская область', img: '50' }, '90': { name: 'Московская область', img: '50' },
            '150': { name: 'Московская область', img: '50' }, '190': { name: 'Московская область', img: '50' },
            '750': { name: 'Московская область', img: '50' }, '790': { name: 'Московская область', img: '50' },
            // Санкт-Петербург и ЛО
            '78': { name: 'г. Санкт-Петербург', img: '78' }, '98': { name: 'г. Санкт-Петербург', img: '78' },
            '178': { name: 'г. Санкт-Петербург', img: '78' }, '198': { name: 'г. Санкт-Петербург', img: '78' },
            '47': { name: 'Ленинградская область', img: '47' }, '147': { name: 'Ленинградская область', img: '47' },
            // Краснодарский край и Юг
            '23': { name: 'Краснодарский край', img: '23' }, '93': { name: 'Краснодарский край', img: '23' },
            '123': { name: 'Краснодарский край', img: '23' }, '193': { name: 'Краснодарский край', img: '23' },
            '323': { name: 'Краснодарский край', img: '23' }, '723': { name: 'Краснодарский край', img: '23' },
            '61': { name: 'Ростовская область', img: '61' }, '161': { name: 'Ростовская область', img: '61' }, '761': { name: 'Ростовская область', img: '61' },
            '26': { name: 'Ставропольский край', img: '26' }, '126': { name: 'Ставропольский край', img: '26' },
            '34': { name: 'Волгоградская область', img: '34' }, '134': { name: 'Волгоградская область', img: '34' },
            '30': { name: 'Астраханская область', img: '30' }, '130': { name: 'Астраханская область', img: '30' },
            '01': { name: 'Республика Адыгея', img: '01' }, '101': { name: 'Республика Адыгея', img: '01' },
            // Поволжье и Урал
            '16': { name: 'Республика Татарстан', img: '16' }, '116': { name: 'Республика Татарстан', img: '16' }, '716': { name: 'Республика Татарстан', img: '16' },
            '02': { name: 'Республика Башкортостан', img: '02' }, '102': { name: 'Республика Башкортостан', img: '02' }, '702': { name: 'Республика Башкортостан', img: '02' },
            '63': { name: 'Самарская область', img: '63' }, '163': { name: 'Самарская область', img: '63' }, '763': { name: 'Самарская область', img: '63' },
            '52': { name: 'Нижегородская область', img: '52' }, '152': { name: 'Нижегородская область', img: '52' }, '252': { name: 'Нижегородская область', img: '52' },
            '66': { name: 'Свердловская область', img: '66' }, '96': { name: 'Свердловская область', img: '66' }, '196': { name: 'Свердловская область', img: '66' },
            '74': { name: 'Челябинская область', img: '74' }, '174': { name: 'Челябинская область', img: '74' }, '774': { name: 'Челябинская область', img: '74' },
            '59': { name: 'Пермский край', img: '59' }, '159': { name: 'Пермский край', img: '59' },
            '18': { name: 'Удмуртская Республика', img: '18' }, '118': { name: 'Удмуртская Республика', img: '18' },
            '64': { name: 'Саратовская область', img: '64' }, '164': { name: 'Саратовская область', img: '64' },
            '58': { name: 'Пензенская область', img: '58' }, '158': { name: 'Пензенская область', img: '58' },
            // Сибирь и Дальний Восток
            '54': { name: 'Новосибирская область', img: '54' }, '154': { name: 'Новосибирская область', img: '54' }, '754': { name: 'Новосибирская область', img: '54' },
            '24': { name: 'Красноярский край', img: '24' }, '124': { name: 'Красноярский край', img: '24' },
            '38': { name: 'Иркутская область', img: '38' }, '138': { name: 'Иркутская область', img: '38' },
            '55': { name: 'Омская область', img: '55' }, '155': { name: 'Омская область', img: '55' },
            '42': { name: 'Кемеровская область', img: '42' }, '142': { name: 'Кемеровская область', img: '42' },
            '72': { name: 'Тюменская область', img: '72' }, '172': { name: 'Тюменская область', img: '72' },
            '25': { name: 'Приморский край', img: '25' }, '125': { name: 'Приморский край', img: '25' }, '725': { name: 'Приморский край', img: '25' },
            '27': { name: 'Хабаровский край', img: '27' }, '127': { name: 'Хабаровский край', img: '27' },
            // Центральная Россия и Северо-Запад
            '36': { name: 'Воронежская область', img: '36' }, '136': { name: 'Воронежская область', img: '36' },
            '31': { name: 'Белгородская область', img: '31' }, '131': { name: 'Белгородская область', img: '31' },
            '46': { name: 'Курская область', img: '46' }, '48': { name: 'Липецкая область', img: '48' },
            '71': { name: 'Тульская область', img: '71' }, '33': { name: 'Владимирская область', img: '33' },
            '37': { name: 'Ивановская область', img: '37' }, '76': { name: 'Ярославская область', img: '76' },
            '40': { name: 'Калужская область', img: '40' }, '62': { name: 'Рязанская область', img: '62' },
            '69': { name: 'Тверская область', img: '69' }, '39': { name: 'Калининградская область', img: '39' },
            '139': { name: 'Калининградская область', img: '39' }, '51': { name: 'Мурманская область', img: '51' },
            '10': { name: 'Республика Карелия', img: '10' }, '29': { name: 'Архангельская область', img: '29' },
            '35': { name: 'Вологодская область', img: '35' }
        };

        const elAmbientBg = document.getElementById('ambientBg');
        const elPlateStage = document.getElementById('plateStage');
        const elRegionLocationName = document.getElementById('regionLocationName');
        const elActiveBuffsBar = document.getElementById('activeBuffsBar');
        const elLicensePlate = document.getElementById('licensePlate');

        function renderActiveBuffsUI() {
            const pills = [];
            if (streakShields > 0) {
                pills.push(`<span class="buff-pill buff-shield" title="Активна страховка серии при пропуске номера">&#128737; ${streakShields}</span>`);
            }
            if (goldenMagnetCharges > 0) {
                pills.push(`<span class="buff-pill buff-magnet" title="Магнит красивых номеров: осталось ${goldenMagnetCharges} ход(а)">&#129522; ${goldenMagnetCharges}</span>`);
            }
            if (gameMode === 'ru' && orderedRegionCode) {
                pills.push(`<span class="buff-pill buff-region" title="Следующий номер выпадет с регионом ${orderedRegionCode}">&#128205; ${orderedRegionCode}</span>`);
            }
            elActiveBuffsBar.innerHTML = pills.join('');
        }

        const elLetter1 = document.getElementById('letter1');
        const elLetter2 = document.getElementById('letter2');
        const elLetter3 = document.getElementById('letter3');
        const elDigits = document.getElementById('digits');
        const elRegion = document.getElementById('region');

        const elGoldenBonusBanner = document.getElementById('goldenBonusBanner');
        const elGoldenBonusReason = document.getElementById('goldenBonusReason');

        const elPills = [
            document.getElementById('pill0'),
            document.getElementById('pill1'),
            document.getElementById('pill2')
        ];

        const elScoreVal = document.getElementById('scoreVal');
        const elWordsCountVal = document.getElementById('wordsCountVal');
        const elStreakVal = document.getElementById('streakVal');
        const elHistoryBadge = document.getElementById('historyBadge');

        const elRankProgressCard = document.getElementById('rankProgressCard');
        const elRankLevelBadge = document.getElementById('rankLevelBadge');
        const elRankNameText = document.getElementById('rankNameText');
        const elRankCounterText = document.getElementById('rankCounterText');
        const elRankBarFill = document.getElementById('rankBarFill');
        const elRankVehicle = document.getElementById('rankVehicle');
        const elRankVehicleImg = document.getElementById('rankVehicleImg');
        const elRankVehicleFallback = document.getElementById('rankVehicleFallback');
        let lastLoadedModelKey = '';

        // Титулы и соответствующие им модельки транспорта
        const RANKS_RU = [
            { minWords: 0, title: 'Пешеход', icon: '&#128694;' },
            { minWords: 10, title: 'Начинающий водитель', icon: '&#128663;' },
            { minWords: 30, title: 'Автолюбитель', icon: '&#128665;' },
            { minWords: 75, title: 'Знаток трасс', icon: '&#128661;' },
            { minWords: 150, title: 'Опытный штурман', icon: '&#128656;' },
            { minWords: 300, title: 'Мастер серпантинов', icon: '&#127950;' },
            { minWords: 600, title: 'Дальнобойщик', icon: '&#128667;' },
            { minWords: 1500, title: 'Покоритель дорог', icon: '&#128652;' },
            { minWords: 5000, title: 'Легенда автопробега', icon: '&#128659;' },
            { minWords: 10000, title: 'Турист России', icon: '&#128653;' }
        ];

        const RANKS_UK = [
            { minWords: 0, title: 'Pedestrian', icon: '&#128694;' },
            { minWords: 10, title: 'Learner Driver', icon: '&#128663;' },
            { minWords: 30, title: 'City Cruiser', icon: '&#128665;' },
            { minWords: 75, title: 'Motorway Scout', icon: '&#128656;' },
            { minWords: 150, title: 'Skilled Navigator', icon: '&#127950;' },
            { minWords: 300, title: 'Highland Driver', icon: '&#128667;' },
            { minWords: 600, title: 'London Cabbie', icon: '&#128661;' },
            { minWords: 1500, title: 'Knight of the Road', icon: '&#128652;' },
            { minWords: 5000, title: 'Royal Tourer', icon: '&#128659;' },
            { minWords: 10000, title: 'Tourist of Britain', icon: '&#128653;' }
        ];


        function getRankStatus(wordsCount) {
            const list = gameMode === 'uk' ? RANKS_UK : RANKS_RU;
            let levelIdx = 0;

            for (let i = 0; i < list.length; i++) {
                if (wordsCount >= list[i].minWords) {
                    levelIdx = i;
                } else {
                    break;
                }
            }

            const current = list[levelIdx];
            const next = list[levelIdx + 1] || null;

            let percent = 100;
            if (next) {
                const span = next.minWords - current.minWords;
                const done = wordsCount - current.minWords;
                percent = Math.min(100, Math.max(0, (done / span) * 100));
            }

            return {
                level: levelIdx + 1,
                totalLevels: list.length,
                title: current.title,
                icon: current.icon,
                nextTarget: next ? next.minWords : null,
                percent,
                isMax: !next
            };
        }

        const elWordInput = document.getElementById('wordInput');
        const elLivePointsBadge = document.getElementById('livePointsBadge');
        const elCheckBtn = document.getElementById('checkBtn');
        const elStatusBox = document.getElementById('statusBox');
        const elNextPlateBtn = document.getElementById('nextPlateBtn');
        const elHintBtn = document.getElementById('hintBtn');
        const elHintBox = document.getElementById('hintBox');
        const elHintMaskText = document.getElementById('hintMaskText');
        const elHintLengthText = document.getElementById('hintLengthText');

        const elBrandBadge = document.getElementById('brandBadge');
        const elBrandTitle = document.getElementById('brandTitle');
        const elLangModeBtn = document.getElementById('langModeBtn');
        const elLangFlagIcon = document.getElementById('langFlagIcon');
        const elFolderPermissionText = document.getElementById('folderPermissionText');

        const elSoundToggleBtn = document.getElementById('soundToggleBtn');
        const elSoundIcon = document.getElementById('soundIcon');
        const elThemeToggleBtn = document.getElementById('themeToggleBtn');
        const elThemeIcon = document.getElementById('themeIcon');

        function updateModeHeaderUI() {
            if (gameMode === 'uk') {
                elBrandBadge.textContent = 'UK';
                elBrandBadge.classList.add('is-uk-badge');
                elBrandTitle.textContent = 'UK Plates';
                elLangFlagIcon.innerHTML = '&#127479;&#127482;'; // Флаг РФ для возврата
                elLangModeBtn.title = 'Переключить на российский режим (RUS)';
                elWordInput.placeholder = 'Введите английское слово с буквами номера...';
            } else {
                elBrandBadge.textContent = 'RUS';
                elBrandBadge.classList.remove('is-uk-badge');
                elBrandTitle.textContent = 'Автослова';
                elLangFlagIcon.innerHTML = '&#127468;&#127463;'; // Флаг UK
                elLangModeBtn.title = 'Переключить на британский режим (UK)';
                elWordInput.placeholder = 'Введите слово с буквами номера...';
            }
        }

        elLangModeBtn.addEventListener('click', async () => {
            saveProgress();
            stopHintTimer();
            currentHintWord = null;
            hintRevealedIndices.clear();
            elHintBox.classList.remove('visible');
            elHintBtn.disabled = false;
            elWordInput.value = '';
            hideStatus();

            gameMode = gameMode === 'ru' ? 'uk' : 'ru';
            localStorage.setItem(STORAGE_KEY_MODE, gameMode);
            updateModeHeaderUI();
            loadProgress();
            updateLiveLetterIndicators(false);
            SoundFX.flip();

            await initDictionary(gameMode);
            if (!currentHintWord && getActiveDictionary().size > 0 && !hasEnoughSolutions(currentPlate.letters, 5)) {
                generateNewPlateData();
                saveProgress();
                renderPlate(false);
            }
            elWordInput.focus();
        });


        function updateSoundButtonUI() {
            const on = SoundFX.isEnabled();
            elSoundIcon.innerHTML = on ? '&#128266;' : '&#128263;';
            elSoundToggleBtn.classList.toggle('is-muted', !on);
            elSoundToggleBtn.title = on ? 'Выключить звук' : 'Включить звук';
        }

        elSoundToggleBtn.addEventListener('click', () => {
            SoundFX.toggle();
            updateSoundButtonUI();
        });


        const elRulesModal = document.getElementById('rulesModal');
        const elRulesBtn = document.getElementById('rulesBtn');
        const elCloseRulesX = document.getElementById('closeRulesX');
        const elStartPlayBtn = document.getElementById('startPlayBtn');
        const elDictStatsInRules = document.getElementById('dictStatsInRules');
        const elReloadDictBtn = document.getElementById('reloadDictBtn');
        const elResetProgressRulesBtn = document.getElementById('resetProgressRulesBtn');


        const elHistoryModal = document.getElementById('historyModal');
        const elHistoryBtn = document.getElementById('historyBtn');
        const elCloseHistoryX = document.getElementById('closeHistoryX');
        const elTabAllBtn = document.getElementById('tabAllBtn');
        const elTabCurrentBtn = document.getElementById('tabCurrentBtn');
        const elHistoryModalBody = document.getElementById('historyModalBody');

        const elCollectionBtn = document.getElementById('collectionBtn');
        const elCollectionBadge = document.getElementById('collectionBadge');
        const elCollectionModal = document.getElementById('collectionModal');
        const elCloseCollectionX = document.getElementById('closeCollectionX');
        const elCollectionTabsBar = document.getElementById('collectionTabsBar');
        const elTabColPlatesBtn = document.getElementById('tabColPlatesBtn');
        const elTabColAtlasBtn = document.getElementById('tabColAtlasBtn');
        const elCollectionModalBody = document.getElementById('collectionModalBody');


        const elShopBtn = document.getElementById('shopBtn');
        const elShopModal = document.getElementById('shopModal');
        const elCloseShopX = document.getElementById('closeShopX');
        const elShopModalBody = document.getElementById('shopModalBody');

        const elRanksModal = document.getElementById('ranksModal');
        const elCloseRanksX = document.getElementById('closeRanksX');
        const elRanksModalBody = document.getElementById('ranksModalBody');



        const elFolderPermissionBar = document.getElementById('folderPermissionBar');
        const elGrantFolderBtn = document.getElementById('grantFolderBtn');
        const elAutoWinTestBtn = document.getElementById('autoWinTestBtn');
        const elAddFuelTestBtn = document.getElementById('addFuelTestBtn');
        const elResetTestBtn = document.getElementById('resetTestBtn');



        function formatNumber(num) {
            return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
        }

        // Анализ «красоты» номера
        function analyzeBeautifulPlate(plate) {
            const [l1, l2, l3] = plate.letters;
            const d = plate.digits;
            const r = plate.region;

            let goldL1 = false;
            let goldL2 = false;
            let goldL3 = false;
            let goldDigits = false;
            let goldRegion = false;
            let reasons = [];

            // Проверка букв
            if (l1 === l2 && l2 === l3) {
                goldL1 = goldL2 = goldL3 = true;
                reasons.push(`три одинаковые буквы (${l1}${l2}${l3})`);
            } else if (l1 === l3) {
                goldL1 = goldL3 = true;
                reasons.push(`зеркальные буквы (${l1}–${l3})`);
            }

            // Проверка цифр
            const isSameDigits = (d[0] === d[1] && d[1] === d[2]);
            const isRoundHundreds = (d[1] === '0' && d[2] === '0');
            const isFirstTen = (d[0] === '0' && d[1] === '0');
            const isMirrorDigits = (d[0] === d[2] && !isSameDigits && !isRoundHundreds && !isFirstTen);
            const isSequential = (d === '123' || d === '234' || d === '345' || d === '456' || d === '567' || d === '678' || d === '789');

            if (isSameDigits) {
                goldDigits = true;
                reasons.push(`три одинаковые цифры (${d})`);
            } else if (isRoundHundreds) {
                goldDigits = true;
                reasons.push(`ровная сотня (${d})`);
            } else if (isFirstTen) {
                goldDigits = true;
                reasons.push(`номер из первой десятки (${d})`);
            } else if (isSequential) {
                goldDigits = true;
                reasons.push(`цифры по порядку (${d})`);
            } else if (isMirrorDigits) {
                goldDigits = true;
                reasons.push(`зеркальные цифры (${d})`);
            }

                // Совпадение цифр с кодом региона (только для режима RUS)
            if (gameMode === 'ru' && r) {
                const paddedRegion = r.padStart(3, '0');
                if (d === r || d === paddedRegion) {
                    goldDigits = true;
                    goldRegion = true;
                    reasons.push(`цифры совпадают с кодом региона (${r})`);
                }
            }


            const isBeautiful = reasons.length > 0;
            const shortReason = reasons.join(' + ');
            let reasonText = '';
            if (isBeautiful) {
                reasonText = `Красивый номер: ${shortReason}. Бензин за слово удваивается!`;
            }

            return {
                isBeautiful,
                goldL1,
                goldL2,
                goldL3,
                goldDigits,
                goldRegion,
                shortReason,
                reasonText
            };
        }


        // Тема оформления
        function applyTheme(theme) {
            if (theme === 'light') {
                document.documentElement.setAttribute('data-theme', 'light');
                elThemeIcon.innerHTML = '&#9790;';
                elThemeToggleBtn.title = 'Переключить на тёмную тему';
            } else {
                document.documentElement.removeAttribute('data-theme');
                elThemeIcon.innerHTML = '&#9728;';
                elThemeToggleBtn.title = 'Переключить на светлую тему';
            }
            localStorage.setItem(STORAGE_KEY_THEME, theme);
        }


        elThemeToggleBtn.addEventListener('click', () => {
            const isLight = document.documentElement.getAttribute('data-theme') === 'light';
            applyTheme(isLight ? 'dark' : 'light');
        });

        // Сохранение и загрузка прогресса
        function saveProgress() {
            const data = {
                currentPlate,
                score,
                streak,
                historyList,
                collectionList,
                ownedSkins,
                equippedSkin,
                streakShields,
                goldenMagnetCharges,
                orderedRegionCode,
                hintState: currentHintWord ? {
                    word: currentHintWord,
                    isFree: isFreeHintActive,
                    revealedIndices: Array.from(hintRevealedIndices),
                    secondsLeft: hintSecondsLeft
                } : null
            };
            localStorage.setItem(getProgressStorageKey(), JSON.stringify(data));
        }

        function loadProgress() {
            const savedTheme = localStorage.getItem(STORAGE_KEY_THEME) || 'dark';
            applyTheme(savedTheme);
            updateSoundButtonUI();
            updateModeHeaderUI();

            currentHintWord = null;
            isFreeHintActive = false;
            hintRevealedIndices.clear();
            hintSecondsLeft = 60;
            score = 0;
            streak = 0;
            historyList = [];
            collectionList = [];
            ownedSkins = ['default'];
            equippedSkin = 'default';
            streakShields = 0;
            goldenMagnetCharges = 0;
            orderedRegionCode = null;
            usedWordsSet = new Set();

            const raw = localStorage.getItem(getProgressStorageKey());
            if (raw) {
                try {
                    const data = JSON.parse(raw);
                    if (data.currentPlate && Array.isArray(data.currentPlate.letters)) {
                        currentPlate = data.currentPlate;
                    } else {
                        generateNewPlateData();
                    }
                    score = typeof data.score === 'number' ? data.score : 0;
                    streak = typeof data.streak === 'number' ? data.streak : 0;
                    historyList = Array.isArray(data.historyList) ? data.historyList : [];
                    collectionList = Array.isArray(data.collectionList) ? data.collectionList : [];
                    ownedSkins = Array.isArray(data.ownedSkins) && data.ownedSkins.length > 0 ? data.ownedSkins : ['default'];
                    equippedSkin = typeof data.equippedSkin === 'string' ? data.equippedSkin : 'default';
                    streakShields = typeof data.streakShields === 'number' ? data.streakShields : 0;
                    goldenMagnetCharges = typeof data.goldenMagnetCharges === 'number' ? data.goldenMagnetCharges : 0;
                    orderedRegionCode = typeof data.orderedRegionCode === 'string' ? data.orderedRegionCode : null;
                    usedWordsSet = new Set(historyList.map(item => item.word));



                    if (data.hintState && typeof data.hintState.word === 'string' && Array.isArray(data.hintState.revealedIndices)) {
                        currentHintWord = data.hintState.word;
                        isFreeHintActive = Boolean(data.hintState.isFree);
                        hintRevealedIndices = new Set(data.hintState.revealedIndices);
                        hintSecondsLeft = typeof data.hintState.secondsLeft === 'number' ? data.hintState.secondsLeft : 60;
                    }

                } catch (e) {
                    generateNewPlateData();
                }
            } else {
                generateNewPlateData();
                saveProgress();
            }

            renderPlate(false);
            updateStatsUI(false);

            if (currentHintWord) {
                elHintBtn.style.display = 'none';
                elHintBox.classList.add('visible');
                startHintTimer(hintSecondsLeft);
            } else {
                resetHintUI();
            }
        }



                // Проверка наличия достаточного количества доступных слов в словаре для тройки букв
        function hasEnoughSolutions(letters, minCount = 5) {
            const dict = getActiveDictionary();
            if (dict.size === 0) return true;
            let found = 0;
            for (const word of dict) {
                if (!usedWordsSet.has(word) && checkLettersOrder(word, letters)) {
                    found++;
                    if (found >= minCount) return true;
                }
            }
            return false;
}

        // Генерация случайного номера с гарантией решаемости и учётом расходников
        function generateNewPlateData() {
            const alphabet = gameMode === 'uk' ? ALLOWED_LETTERS_UK : ALLOWED_LETTERS_RU;
            let l1, l2, l3;
            let attempts = 0;
            const maxAttempts = 40;

            do {
                l1 = alphabet[Math.floor(Math.random() * alphabet.length)];
                l2 = alphabet[Math.floor(Math.random() * alphabet.length)];
                l3 = alphabet[Math.floor(Math.random() * alphabet.length)];
                attempts++;
            } while (attempts < maxAttempts && !hasEnoughSolutions([l1, l2, l3], 5));

            let num = Math.floor(Math.random() * 999) + 1;
            let digits = num.toString().padStart(3, '0');

            // Если активен «Магнит красивых номеров» — гарантируем красивую комбинацию
            if (goldenMagnetCharges > 0) {
                goldenMagnetCharges--;
                const beautyPatterns = [
                    () => { const d = Math.floor(Math.random() * 9) + 1; return `${d}${d}${d}`; },
                    () => { const a = Math.floor(Math.random() * 9) + 1; const b = Math.floor(Math.random() * 10); return `${a}${b}${a}`; },
                    () => { const h = Math.floor(Math.random() * 9) + 1; return `${h}00`; },
                    () => { const seq = ['123', '234', '345', '456', '567', '678', '789']; return seq[Math.floor(Math.random() * seq.length)]; }
                ];
                digits = beautyPatterns[Math.floor(Math.random() * beautyPatterns.length)]();
            }

            let region = 'UK';
            if (gameMode !== 'uk') {
                if (orderedRegionCode) {
                    region = orderedRegionCode;
                    orderedRegionCode = null;
                } else {
                    region = REGIONS[Math.floor(Math.random() * REGIONS.length)];
                }
            }

            currentPlate = {
                letters: [l1, l2, l3],
                digits,
                region
            };
        }

                function loadStageBackgroundImage(baseName, expectedKey) {
            const extensions = ['jpg', 'jpeg', 'png', 'webp'];
            let extIndex = 0;

            const tryNext = () => {
                const currentKey = gameMode === 'uk' ? 'UK' : currentPlate.region;
                if (currentKey !== expectedKey) return;

                if (extIndex >= extensions.length) {
                    elPlateStage.style.backgroundImage = '';
                    elPlateStage.classList.remove('has-region-bg');
                    elAmbientBg.classList.remove('active');
                    return;
                }

                const imgPath = `regions/${baseName}.${extensions[extIndex]}`;
                const testImg = new Image();
                testImg.onload = () => {
                    const checkKey = gameMode === 'uk' ? 'UK' : currentPlate.region;
                    if (checkKey !== expectedKey) return;
                    elPlateStage.style.backgroundImage = `url('${imgPath}')`;
                    elPlateStage.classList.add('has-region-bg');
                    elAmbientBg.style.backgroundImage = `url('${imgPath}')`;
                    elAmbientBg.classList.add('active');
                };
                testImg.onerror = () => {
                    extIndex++;
                    tryNext();
                };
                testImg.src = imgPath;
            };

            tryNext();
}

        function applyPlateSkinClass() {
            PLATE_SKINS.forEach(s => {
                if (s.plateClass) elLicensePlate.classList.remove(s.plateClass);
            });
            const activeSkinObj = PLATE_SKINS.find(s => s.id === equippedSkin);
            if (activeSkinObj && activeSkinObj.plateClass) {
                elLicensePlate.classList.add(activeSkinObj.plateClass);
            }
        }

        function renderPlate(animate = true) {
            const applyValues = () => {
                const isUK = gameMode === 'uk';
                elLicensePlate.classList.toggle('is-uk-plate', isUK);
                applyPlateSkinClass();


                elLetter1.textContent = currentPlate.letters[0];
                elLetter2.textContent = currentPlate.letters[1];
                elLetter3.textContent = currentPlate.letters[2];
                elDigits.textContent = currentPlate.digits;
                elRegion.textContent = currentPlate.region;

                if (isUK) {
                    elRegionLocationName.textContent = 'United Kingdom (London)';
                    loadStageBackgroundImage('uk', 'UK');
                } else {
                    const regInfo = REGION_INFO[currentPlate.region];
                    if (regInfo) {
                        elRegionLocationName.textContent = regInfo.name;
                        loadStageBackgroundImage(regInfo.img, currentPlate.region);
                    } else {
                        elRegionLocationName.textContent = `Регион ${currentPlate.region}`;
                        elPlateStage.style.backgroundImage = '';
                        elPlateStage.classList.remove('has-region-bg');
                        elAmbientBg.classList.remove('active');
                    }
                }



                // Анализ и подсветка красивого номера
                const beauty = analyzeBeautifulPlate(currentPlate);
                elLetter1.classList.toggle('gold-part', beauty.goldL1);
                elLetter2.classList.toggle('gold-part', beauty.goldL2);
                elLetter3.classList.toggle('gold-part', beauty.goldL3);
                elDigits.classList.toggle('gold-part', beauty.goldDigits);
                elRegion.classList.toggle('gold-part', beauty.goldRegion);

                elLicensePlate.classList.toggle('is-golden-plate', beauty.isBeautiful);
                elPlateStage.classList.toggle('is-golden-stage', beauty.isBeautiful);

                if (beauty.isBeautiful) {
                    elGoldenBonusReason.textContent = beauty.reasonText;
                    elGoldenBonusBanner.classList.add('visible');
                } else {
                    elGoldenBonusBanner.classList.remove('visible');
                }

                elPills.forEach((pill, idx) => {
                    pill.textContent = currentPlate.letters[idx];
                    pill.classList.remove('matched');
                });
            };

            if (animate) {
                elLicensePlate.classList.add('flip-anim');
                setTimeout(() => {
                    applyValues();
                    elLicensePlate.classList.remove('flip-anim');
                }, 170);
            } else {
                applyValues();
            }
        }

        const MIN_SCORE_LIMIT = -500;
        let displayedScore = 0;
        let fuelAnimFrame = null;

        function animateFuelCounter(targetScore) {
            if (fuelAnimFrame) {
                cancelAnimationFrame(fuelAnimFrame);
                fuelAnimFrame = null;
            }

            const startScore = displayedScore;
            const diff = targetScore - startScore;

            if (diff === 0) {
                elScoreVal.textContent = `${formatNumber(targetScore)} л`;
                elScoreVal.classList.toggle('negative', targetScore < 0);
                elScoreVal.classList.remove('fuel-pumping-up', 'fuel-pumping-down');
                return;
            }

            const isUp = diff > 0;
            elScoreVal.classList.remove('fuel-pumping-up', 'fuel-pumping-down');
            elScoreVal.classList.add(isUp ? 'fuel-pumping-up' : 'fuel-pumping-down');

            // Длительность зависит от объёма заправки (от 420 мс до 950 мс)
            const duration = Math.min(950, Math.max(420, Math.abs(diff) * 2.2));
            const startTime = performance.now();

            const step = (now) => {
                const elapsed = now - startTime;
                const progress = Math.min(1, elapsed / duration);
                // Плавное замедление в конце (easeOutCubic), как отсечка пистолета на АЗС
                const eased = 1 - Math.pow(1 - progress, 3);

                displayedScore = Math.round(startScore + diff * eased);
                elScoreVal.textContent = `${formatNumber(displayedScore)} л`;
                elScoreVal.classList.toggle('negative', displayedScore < 0);

                if (progress < 1) {
                    fuelAnimFrame = requestAnimationFrame(step);
                } else {
                    displayedScore = targetScore;
                    elScoreVal.textContent = `${formatNumber(targetScore)} л`;
                    elScoreVal.classList.toggle('negative', targetScore < 0);
                    elScoreVal.classList.remove('fuel-pumping-up', 'fuel-pumping-down');
                    fuelAnimFrame = null;
                }
            };

            fuelAnimFrame = requestAnimationFrame(step);
        }

        function updateStatsUI(animateFuel = true) {
            if (animateFuel) {
                animateFuelCounter(score);
            } else {
                if (fuelAnimFrame) {
                    cancelAnimationFrame(fuelAnimFrame);
                    fuelAnimFrame = null;
                }
                displayedScore = score;
                elScoreVal.textContent = `${formatNumber(score)} л`;
                elScoreVal.classList.toggle('negative', score < 0);
                elScoreVal.classList.remove('fuel-pumping-up', 'fuel-pumping-down');
            }

            elWordsCountVal.textContent = formatNumber(historyList.length);
            elHistoryBadge.textContent = formatNumber(historyList.length);
            elCollectionBadge.textContent = formatNumber(collectionList.length);

            elStreakVal.textContent = formatNumber(streak);
            elStreakVal.classList.toggle('streak-active', streak > 0);

            // Обновление шкалы прогресса, звания и позиции модельки транспорта
            const wordsCount = historyList.length;
            const rankInfo = getRankStatus(wordsCount);
            elRankLevelBadge.textContent = `Ур. ${rankInfo.level}/${rankInfo.totalLevels}`;
            elRankNameText.textContent = rankInfo.title;
            elRankBarFill.style.width = `${rankInfo.percent.toFixed(1)}%`;
            elRankProgressCard.classList.toggle('is-max-rank', rankInfo.isMax);

            // Ограничиваем позицию от 4% до 96%, чтобы моделька не выходила за края карточки
            const clampedPos = Math.min(96, Math.max(4, rankInfo.percent));
            elRankVehicle.style.left = `${clampedPos.toFixed(1)}%`;
            updateRankVehicleModel(rankInfo.level, rankInfo.icon);


            if (rankInfo.nextTarget !== null) {
                elRankCounterText.textContent = `${formatNumber(wordsCount)} / ${formatNumber(rankInfo.nextTarget)} слов`;
            } else {
                elRankCounterText.textContent = `${formatNumber(wordsCount)} слов (Макс. ранг)`;
            }

            // Проверка лимита -500 л для кнопок пропуска и подсказки
            const isAtMinLimit = score <= MIN_SCORE_LIMIT;
            const canSkip = (score - 50) >= MIN_SCORE_LIMIT;

            elNextPlateBtn.disabled = !canSkip;
            elNextPlateBtn.title = canSkip
                ? 'Сменить номер за 50 л бензина'
                : `Достигнут минимальный лимит (${MIN_SCORE_LIMIT} л). Отгадайте слово или воспользуйтесь бесплатной подсказкой!`;

            elHintBtn.classList.toggle('is-free-hint', isAtMinLimit);
            elHintBtn.innerHTML = isAtMinLimit
                ? '<span>&#128161;</span> Подсказка (бесплатно)'
                : '<span>&#128161;</span> Подсказка (-40 л)';

            renderActiveBuffsUI();
        }

        function updateRankVehicleModel(level, fallbackIcon) {
            const modelKey = `${gameMode}_${level}`;
            if (lastLoadedModelKey === modelKey) return;
            lastLoadedModelKey = modelKey;

            elRankVehicleFallback.innerHTML = fallbackIcon;

            const baseNames = gameMode === 'uk' ? [`uk_${level}`, `${level}`] : [`${level}`];
            const extensions = ['png', 'svg', 'webp', 'gif', 'jpg'];
            const candidates = [];

            baseNames.forEach(name => {
                extensions.forEach(ext => candidates.push(`models/${name}.${ext}`));
            });

            let idx = 0;
            const tryNextModel = () => {
                if (lastLoadedModelKey !== modelKey) return;

                if (idx >= candidates.length) {
                    elRankVehicleImg.style.display = 'none';
                    elRankVehicleFallback.style.display = 'inline-block';
                    return;
                }

                const path = candidates[idx];
                const probe = new Image();
                probe.onload = () => {
                    if (lastLoadedModelKey !== modelKey) return;
                    elRankVehicleImg.src = path;
                    elRankVehicleImg.style.display = 'block';
                    elRankVehicleFallback.style.display = 'none';
                };
                probe.onerror = () => {
                    idx++;
                    tryNextModel();
                };
                probe.src = path;
            };

            tryNextModel();
        }



        // Живая подсветка букв и расчёт потенциальных очков при наборе текста
        function updateLiveLetterIndicators(isTyping = false) {
            const cleanRaw = elWordInput.value.trim();
            const val = cleanRaw.toUpperCase().replace(/Ё/g, 'Е');
            let targetIdx = 0;

            for (let i = 0; i < val.length; i++) {
                if (targetIdx < 3 && val[i] === currentPlate.letters[targetIdx]) {
                    targetIdx++;
                }
            }

            if (isTyping && cleanRaw.length > 0) {
                if (targetIdx > lastMatchedPillsCount) {
                    SoundFX.pillMatch(targetIdx);
                } else {
                    SoundFX.keyTick();
                }
            }
            lastMatchedPillsCount = targetIdx;

            elPills.forEach((pill, idx) => {
                if (idx < targetIdx) {
                    pill.classList.add('matched');
                } else {
                    pill.classList.remove('matched');
                }
            });


                // Обновление бейджа потенциальных очков справа в поле ввода
            const lettersOnly = gameMode === 'uk'
                ? cleanRaw.replace(/[^a-zA-Z]/g, '')
                : cleanRaw.replace(/[^а-яА-ЯёЁ]/g, '');

            if (lettersOnly.length === 0) {
                elLivePointsBadge.className = 'live-points-badge';
                elLivePointsBadge.textContent = '';
                return;
            }

            const beauty = analyzeBeautifulPlate(currentPlate);
            const mult = getActiveMultiplier(beauty.isBeautiful);
            const potentialPoints = lettersOnly.length * 10 * mult;
            elLivePointsBadge.textContent = mult > 1 ? `+${potentialPoints} л x${mult}` : `+${potentialPoints} л`;

            if (targetIdx === 3 && lettersOnly.length >= 3) {
                elLivePointsBadge.className = `live-points-badge visible ready${beauty.isBeautiful ? ' is-gold' : ''}`;
            } else {
                elLivePointsBadge.className = 'live-points-badge visible';
            }
        }

        elWordInput.addEventListener('input', () => updateLiveLetterIndicators(true));

function triggerInputShake() {
    elWordInput.classList.remove('shake-error');
    void elWordInput.offsetWidth;
    elWordInput.classList.add('shake-error');
}

function showStatus(msg, type, isHtml = false) {
    if (isHtml) {
        elStatusBox.innerHTML = msg;
    } else {
        elStatusBox.textContent = msg;
    }
    elStatusBox.className = `status-box status-${type} visible`;
    if (type === 'error') {
        triggerInputShake();
        SoundFX.error();
    }
}

function hideStatus() {
    elStatusBox.className = 'status-box';
}

function checkLettersOrder(word, letters) {
    let idx = 0;
    const norm = word.toUpperCase().replace(/Ё/g, 'Е');
    for (let i = 0; i < norm.length; i++) {
        if (norm[i] === letters[idx]) {
            idx++;
            if (idx === letters.length) return true;
        }
    }
    return false;
}

// Подробный разбор ошибки порядка букв для «Анти-опечатки»
function buildOrderErrorHTML(rawWord, letters) {
    const norm = rawWord.toUpperCase().replace(/Ё/g, 'Е');
    const origChars = rawWord.toUpperCase().split('');
    let targetIdx = 0;
    const matchedWordIndices = new Set();

    for (let i = 0; i < norm.length; i++) {
        if (targetIdx < letters.length && norm[i] === letters[targetIdx]) {
            matchedWordIndices.add(i);
            targetIdx++;
        }
    }

    const failedLetter = letters[targetIdx];
    const prevLetter = targetIdx > 0 ? letters[targetIdx - 1] : null;
    const existsEarlier = norm.includes(failedLetter);

    let reasonText = '';
    if (targetIdx === 0) {
        reasonText = `В слове «${rawWord}» вообще нет первой буквы номера <strong>${failedLetter}</strong>.`;
    } else if (existsEarlier) {
        reasonText = `Буква <strong>${failedLetter}</strong> есть в слове, но стоит раньше <strong>${prevLetter}</strong> (нарушен порядок).`;
    } else {
        reasonText = `После буквы <strong>${prevLetter}</strong> в слове не хватает буквы <strong>${failedLetter}</strong>.`;
    }

    const chainHTML = letters.map((letChar, idx) => {
        if (idx < targetIdx) {
            return `<span class="chain-step ok">${letChar} &#10003;</span>`;
        } else if (idx === targetIdx) {
            return `<span class="chain-step fail">${letChar} &#10007;</span>`;
        } else {
            return `<span class="chain-step pending">${letChar}</span>`;
        }
    }).join('<span style="opacity:0.5">&rarr;</span>');

    const previewHTML = origChars.map((ch, idx) => {
        return matchedWordIndices.has(idx) ? `<span class="hl-ok">${ch}</span>` : ch;
    }).join('');

    return `
        <div class="error-breakdown">
            <div>${reasonText}</div>
            <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                <div class="error-chain">${chainHTML}</div>
                <div class="word-letter-preview">${previewHTML}</div>
            </div>
        </div>
    `;
}

// Поиск похожих слов в словаре (расстояние Левенштейна = 1) среди подходящих под номер
        function findSimilarValidWords(rawWord, letters, maxSuggestions = 3) {
            const suggestions = [];
            const len = rawWord.length;
            const dict = getActiveDictionary();

            for (const dictWord of dict) {

        if (usedWordsSet.has(dictWord)) continue;
        if (Math.abs(dictWord.length - len) > 1) continue;
        if (!checkLettersOrder(dictWord, letters)) continue;

        if (isOneEditAway(rawWord, dictWord)) {
            suggestions.push(dictWord);
            if (suggestions.length >= maxSuggestions) break;
        }
    }
    return suggestions;
}

function isOneEditAway(a, b) {
    if (a === b) return false;
    const lenA = a.length;
    const lenB = b.length;
    if (Math.abs(lenA - lenB) > 1) return false;

    let i = 0, j = 0, edits = 0;
    while (i < lenA && j < lenB) {
        if (a[i] === b[j]) {
            i++;
            j++;
        } else {
            edits++;
            if (edits > 1) return false;
            if (lenA > lenB) i++;
            else if (lenB > lenA) j++;
            else { i++; j++; }
        }
    }
    if (i < lenA || j < lenB) edits++;
    return edits === 1;
}

window.applyTypoSuggestion = function(word) {
    elWordInput.value = word;
    updateLiveLetterIndicators();
    elWordInput.focus();
};

        function handleCheckWord() {
            const raw = elWordInput.value.trim().toLowerCase();

            if (!raw) {
                showStatus('Введите слово перед проверкой.', 'warning');
                return;
            }

                const validRegex = gameMode === 'uk' ? /^[a-z]+$/ : /^[а-яё]+$/;
                if (!validRegex.test(raw)) {
                    const langHint = gameMode === 'uk'
                        ? 'Используйте только английские буквы (A–Z) без пробелов и знаков.'
                        : 'Используйте только русские буквы без пробелов и знаков.';
                    showStatus(langHint, 'error');
                    return;
                }

                const dict = getActiveDictionary();
                if (dict.size === 0) {
                const fileName = gameMode === 'uk' ? 'english.txt' : 'russian.txt';
                    showStatus(`Словарь ещё не загружен. Убедитесь, что файл ${fileName} находится в папке с игрой.`, 'error');
                    return;
            }


            if (usedWordsSet.has(raw)) {
                showStatus(`Слово «${raw}» уже было угадано ранее!`, 'warning');
                return;
            }

    if (!checkLettersOrder(raw, currentPlate.letters)) {
        const errorHtml = buildOrderErrorHTML(raw, currentPlate.letters);
        showStatus(errorHtml, 'error', true);
        return;
    }

        if (!dict.has(raw)) {
        const suggestions = findSimilarValidWords(raw, currentPlate.letters, 3);

        if (suggestions.length > 0) {
            const chips = suggestions
                .map(w => `<button type="button" class="typo-chip" onclick="applyTypoSuggestion('${w}')">${w}</button>`)
                .join('');
            const html = `
                <div class="error-breakdown">
                    <div>Слова «${raw}» нет в словаре (возможно, опечатка).</div>
                    <div class="typo-suggestions">
                        <span>Подходящие похожие:</span>
                        ${chips}
                    </div>
                </div>
            `;
            showStatus(html, 'error', true);
        } else {
            showStatus(`Слова «${raw}» нет в словаре.`, 'error');
        }
        return;
    }

            // Слово принято! Проверяем звание до и после добавления слова
            const prevRank = getRankStatus(historyList.length);
            const beauty = analyzeBeautifulPlate(currentPlate);
            const wasFreeHint = isFreeHintActive;
            const mult = getActiveMultiplier(beauty.isBeautiful);
            const basePoints = raw.length * 10;
            const multipliedPoints = basePoints * mult;


            streak++;
            const streakBonus = (streak % 5 === 0) ? 25 : 0;
            const totalEarned = multipliedPoints + streakBonus;


            score += totalEarned;
            usedWordsSet.add(raw);

                const plateString = gameMode === 'uk'
                ? `UK | ${currentPlate.letters[0]} ${currentPlate.digits} ${currentPlate.letters[1]}${currentPlate.letters[2]}`
                : `${currentPlate.letters[0]} ${currentPlate.digits} ${currentPlate.letters[1]}${currentPlate.letters[2]} ${currentPlate.region}`;

            historyList.unshift({
                word: raw,
                letters: [...currentPlate.letters],
                region: currentPlate.region,
                plate: plateString,
                points: totalEarned,
                isBeautiful: beauty.isBeautiful
            });


            if (beauty.isBeautiful) {
                collectionList.unshift({
                    letters: [...currentPlate.letters],
                    digits: currentPlate.digits,
                    region: currentPlate.region,
                    word: raw,
                    points: totalEarned,
                    reason: beauty.shortReason,
                    goldL1: beauty.goldL1,
                    goldL2: beauty.goldL2,
                    goldL3: beauty.goldL3,
                    goldDigits: beauty.goldDigits,
                    goldRegion: beauty.goldRegion
                });
            }

            // Генерируем следующий номер
                resetHintUI();
            generateNewPlateData();
            saveProgress();
            renderPlate(true);
            updateStatsUI();

            SoundFX.success(streakBonus > 0);
            if (analyzeBeautifulPlate(currentPlate).isBeautiful) {
                setTimeout(() => SoundFX.golden(), 260);
            }


            let bonusNotes = [];
            if (beauty.isBeautiful && wasFreeHint) {
                bonusNotes.push('x4: красивый номер + бонус спасения');
            } else if (beauty.isBeautiful) {
                bonusNotes.push('x2 за красивый номер');
            } else if (wasFreeHint) {
                bonusNotes.push('x2 за подсказку спасения');
            }
            if (streakBonus > 0) {
                bonusNotes.push(`+${streakBonus} за ${streak} слов подряд`);
            }

            const newRank = getRankStatus(historyList.length);
            let successMsg = `Верно! Слово «${raw}» принято (+${totalEarned} л`;
            if (bonusNotes.length > 0) {
                successMsg += `, включая ${bonusNotes.join(' и ')}`;
            }
            successMsg += `).`;

            if (newRank.level > prevRank.level) {
                successMsg += ` Новое звание: «${newRank.title}»!`;
            }


            showStatus(successMsg, 'success');
            elWordInput.value = '';
            updateLiveLetterIndicators();
            elWordInput.focus();
        }

        elCheckBtn.addEventListener('click', handleCheckWord);
        elWordInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') handleCheckWord();
        });

        function stopHintTimer() {
            if (hintTimerInterval) {
                clearInterval(hintTimerInterval);
                hintTimerInterval = null;
            }
        }

        function resetHintUI() {
            stopHintTimer();
            currentHintWord = null;
            isFreeHintActive = false;
            hintRevealedIndices.clear();
            hintSecondsLeft = 60;
            elHintBox.classList.remove('visible');
            elHintBtn.style.display = '';
            elHintBtn.disabled = false;
        }


        // Открывает 1 случайную закрытую букву, но только если закрытых букв больше 1
        function revealOneRandomHintLetter() {
            if (!currentHintWord) return false;
            const hiddenIndices = [];
            for (let i = 0; i < currentHintWord.length; i++) {
                if (!hintRevealedIndices.has(i)) {
                    hiddenIndices.push(i);
                }
            }

            // Останавливаемся, когда осталась ровно 1 закрытая буква
            if (hiddenIndices.length <= 1) {
                return false;
            }

            const randomIndex = hiddenIndices[Math.floor(Math.random() * hiddenIndices.length)];
            hintRevealedIndices.add(randomIndex);
            return true;
        }

        function renderHintDisplay() {
            if (!currentHintWord) return;
            const chars = currentHintWord.toUpperCase().split('');
            elHintMaskText.textContent = chars.map((ch, idx) => hintRevealedIndices.has(idx) ? ch : '_').join('');

            const hiddenCount = currentHintWord.length - hintRevealedIndices.size;
            if (hiddenCount <= 1) {
                elHintLengthText.textContent = `${currentHintWord.length} букв (осталась 1 буква)`;
            } else {
                elHintLengthText.textContent = `${currentHintWord.length} букв • +буква через ${hintSecondsLeft}с`;
            }
        }

        function startHintTimer(initialSeconds = 60) {
            stopHintTimer();
            hintSecondsLeft = initialSeconds;
            renderHintDisplay();

            const hiddenCount = currentHintWord.length - hintRevealedIndices.size;
            if (hiddenCount <= 1) return;

            hintTimerInterval = setInterval(() => {
                if (!currentHintWord) {
                    stopHintTimer();
                    return;
                }

                hintSecondsLeft--;
                if (hintSecondsLeft <= 0) {
                    if (revealOneRandomHintLetter()) {
                        SoundFX.hint();
                    }
                    const remainingHidden = currentHintWord.length - hintRevealedIndices.size;
                    if (remainingHidden <= 1) {
                        stopHintTimer();
                    } else {
                        hintSecondsLeft = 60;
                    }
                }
                saveProgress();
                renderHintDisplay();
            }, 1000);
        }


        elHintBtn.addEventListener('click', () => {
            if (currentHintWord) return;

            const dict = getActiveDictionary();
            if (dict.size === 0) {
                showStatus('Словарь ещё не загружен.', 'error');
                return;
            }

            const candidates = [];
            for (const word of dict) {
                if (!usedWordsSet.has(word) && word.length >= 5 && word.length <= 11 && checkLettersOrder(word, currentPlate.letters)) {
                    candidates.push(word);
                }
            }

            if (candidates.length === 0) {
                for (const word of dict) {
                    if (!usedWordsSet.has(word) && word.length <= 11 && checkLettersOrder(word, currentPlate.letters)) {
                        candidates.push(word);
                    }
                }
            }


            if (candidates.length === 0) {
                showStatus('Для этого номера в словаре не осталось новых слов.', 'warning');
                return;
            }

            currentHintWord = candidates[Math.floor(Math.random() * candidates.length)];
            const isFreeHint = score <= MIN_SCORE_LIMIT;
            isFreeHintActive = isFreeHint;
            if (!isFreeHint) {
                score = Math.max(MIN_SCORE_LIMIT, score - 40);
            }
            updateStatsUI();


            // Находим индексы 3 букв номера
            hintRevealedIndices.clear();
            const norm = currentHintWord.toUpperCase().replace(/Ё/g, 'Е');
            let targetIdx = 0;
            for (let i = 0; i < norm.length; i++) {
                if (targetIdx < currentPlate.letters.length && norm[i] === currentPlate.letters[targetIdx]) {
                    hintRevealedIndices.add(i);
                    targetIdx++;
                }
            }

            // Сразу открываем ещё 1 случайную букву (если закрытых больше одной)
            revealOneRandomHintLetter();
            hintSecondsLeft = 60;
            saveProgress();

            elHintBox.classList.add('visible');
            elHintBtn.disabled = true;
            elHintBtn.style.display = 'none';
            elHintBox.classList.add('visible');
            startHintTimer(60);
            SoundFX.hint();
            updateLiveLetterIndicators(false);
            hideStatus();
            elWordInput.focus();
        });

        // Пропуск номера (-50 л и проверка страховки серии)
        elNextPlateBtn.addEventListener('click', () => {
            if (score - 50 < MIN_SCORE_LIMIT) return;
            score -= 50;

            let shieldUsed = false;
            if (streak > 0 && streakShields > 0) {
                streakShields--;
                shieldUsed = true;
            } else {
                streak = 0;
            }

            resetHintUI();
            generateNewPlateData();
            saveProgress();
            renderPlate(true);
            updateStatsUI();

            SoundFX.flip();
            if (analyzeBeautifulPlate(currentPlate).isBeautiful) {
                setTimeout(() => SoundFX.golden(), 220);
            }

            elWordInput.value = '';
            updateLiveLetterIndicators(false);
            elWordInput.focus();

            const skipMsg = shieldUsed
                ? `Номер пропущен (-50 л). Сработала страховка — серия (${streak}) сохранена! (Осталось страховок: ${streakShields})`
                : 'Номер пропущен (-50 л). Серия «Слов подряд» сброшена.';
            showStatus(skipMsg, 'warning');
        });


        // Модальное окно Правил
        function openRulesModal() {
            elRulesModal.classList.add('open');
        }

        function closeRulesModal() {
            elRulesModal.classList.remove('open');
            localStorage.setItem(STORAGE_KEY_RULES_SEEN, 'true');
            elWordInput.focus();
        }

        elRulesBtn.addEventListener('click', openRulesModal);
        elCloseRulesX.addEventListener('click', closeRulesModal);
        elStartPlayBtn.addEventListener('click', closeRulesModal);
        elRulesModal.addEventListener('click', (e) => {
            if (e.target === elRulesModal) closeRulesModal();
        });

        // Модальное окно Истории с вкладками
        function renderHistoryContent() {
            elHistoryModalBody.innerHTML = '';

            if (activeHistoryTab === 'all') {
                if (historyList.length === 0) {
                    elHistoryModalBody.innerHTML = '<div class="empty-state">Вы ещё не угадали ни одного слова.</div>';
                    return;
                }
                historyList.forEach(item => {
                    const row = document.createElement('div');
                    row.className = 'history-item';
                    const badgeClass = item.isBeautiful ? 'history-plate-badge is-gold-badge' : 'history-plate-badge';
                    row.innerHTML = `
                        <span class="history-word">${item.word}</span>
                        <div class="history-meta">
                            <span class="${badgeClass}">${item.plate}</span>
                            <span class="history-points">+${item.points} л</span>
                        </div>
                    `;
                    elHistoryModalBody.appendChild(row);
                });
            } else {
                const curLetters = currentPlate.letters;
                const matchingItems = historyList.filter(item => {
                    if (Array.isArray(item.letters)) {
                        return item.letters[0] === curLetters[0] &&
                               item.letters[1] === curLetters[1] &&
                               item.letters[2] === curLetters[2];
                    }
                    return checkLettersOrder(item.word, curLetters);
                });

                const banner = document.createElement('div');
                banner.className = 'current-letters-banner';
                banner.innerHTML = `
                    <span>Буквы текущего номера: <strong>${curLetters.join(' → ')}</strong></span>
                    <span>Найдено: <strong>${matchingItems.length}</strong></span>
                `;
                elHistoryModalBody.appendChild(banner);

                if (matchingItems.length === 0) {
                    const empty = document.createElement('div');
                    empty.className = 'empty-state';
                    empty.textContent = 'На эти буквы слова ещё не вводились.';
                    elHistoryModalBody.appendChild(empty);
                    return;
                }

                matchingItems.forEach(item => {
                    const row = document.createElement('div');
                    row.className = 'history-item';
                    const badgeClass = item.isBeautiful ? 'history-plate-badge is-gold-badge' : 'history-plate-badge';
                    row.innerHTML = `
                        <span class="history-word">${item.word}</span>
                        <div class="history-meta">
                            <span class="${badgeClass}">${item.plate}</span>
                            <span class="history-points">+${item.points}</span>
                        </div>
                    `;
                    elHistoryModalBody.appendChild(row);
                });
            }
        }

        function openHistoryModal() {
            renderHistoryContent();
            elHistoryModal.classList.add('open');
        }

        function closeHistoryModal() {
            elHistoryModal.classList.remove('open');
        }

        elHistoryBtn.addEventListener('click', openHistoryModal);
        elCloseHistoryX.addEventListener('click', closeHistoryModal);
        elHistoryModal.addEventListener('click', (e) => {
            if (e.target === elHistoryModal) closeHistoryModal();
        });

        elTabAllBtn.addEventListener('click', () => {
            activeHistoryTab = 'all';
            elTabAllBtn.classList.add('active');
            elTabCurrentBtn.classList.remove('active');
            renderHistoryContent();
        });

        elTabCurrentBtn.addEventListener('click', () => {
            activeHistoryTab = 'current';
            elTabCurrentBtn.classList.add('active');
            elTabAllBtn.classList.remove('active');
            renderHistoryContent();
        });

        // Подсчёт открытых регионов России по истории угаданных слов
        function getOpenedRegionsStats() {
            const countsByImgKey = {};
            historyList.forEach(item => {
                let regCode = item.region;
                // Поддержка старых записей истории, где код региона хранился в конце строки item.plate
                if (!regCode && typeof item.plate === 'string') {
                    const parts = item.plate.trim().split(/\s+/);
                    regCode = parts[parts.length - 1];
                }
                const info = REGION_INFO[regCode];
                if (info) {
                    countsByImgKey[info.img] = (countsByImgKey[info.img] || 0) + 1;
                }
            });
            return countsByImgKey;
        }

        // Отрисовка коллекции красивых номеров и Атласа регионов
        function renderCollectionContent() {
            elCollectionModalBody.innerHTML = '';

            // В британском режиме или если Атлас выключен в конфиге — вкладку скрываем
            if (gameMode === 'uk' || !GAME_FEATURES.enableAtlas) {
                elCollectionTabsBar.style.display = 'none';
                activeCollectionTab = 'plates';
            } else {
                elCollectionTabsBar.style.display = 'grid';
                elTabColPlatesBtn.classList.toggle('active', activeCollectionTab === 'plates');
                elTabColAtlasBtn.classList.toggle('active', activeCollectionTab === 'atlas');
            }


            if (activeCollectionTab === 'plates') {
                if (collectionList.length === 0) {
                    elCollectionModalBody.innerHTML = '<div class="empty-state">В коллекции пока пусто. Угадайте слово на красивом номере (с золотой подсветкой), чтобы добавить его сюда!</div>';
                    return;
                }

                // Поисковая строка над списком номеров
                const searchBox = document.createElement('div');
                searchBox.className = 'collection-search-box';
                searchBox.innerHTML = `
                    <input type="text" id="collectionSearchInput" class="collection-search-input" placeholder="Поиск по номеру (А777АА, 23), слову или типу..." autocomplete="off">
                    <button type="button" id="collectionSearchClear" class="collection-search-clear" title="Очистить поиск">&times;</button>
                `;
                elCollectionModalBody.appendChild(searchBox);

                const metaLine = document.createElement('div');
                metaLine.className = 'collection-search-meta';
                elCollectionModalBody.appendChild(metaLine);

                const cardsContainer = document.createElement('div');
                cardsContainer.className = 'collection-cards-list';
                elCollectionModalBody.appendChild(cardsContainer);

                const searchInput = document.getElementById('collectionSearchInput');
                const clearBtn = document.getElementById('collectionSearchClear');
                searchInput.value = collectionSearchQuery;
                clearBtn.classList.toggle('visible', collectionSearchQuery.length > 0);

                const renderFilteredPlates = () => {
                    cardsContainer.innerHTML = '';
                    const qRaw = collectionSearchQuery.trim().toLowerCase();
                    const qCompact = qRaw.replace(/\s+/g, '');

                    const filtered = qRaw === '' ? collectionList : collectionList.filter(item => {
                        const plateSpaced = `${item.letters[0]} ${item.digits} ${item.letters[1]}${item.letters[2]} ${item.region}`.toLowerCase();
                        const plateCompact = `${item.letters[0]}${item.digits}${item.letters[1]}${item.letters[2]}${item.region}`.toLowerCase();
                        const lettersOnly = `${item.letters[0]}${item.letters[1]}${item.letters[2]}`.toLowerCase();
                        const wordMatch = item.word.toLowerCase().includes(qRaw);
                        const reasonMatch = (item.reason || '').toLowerCase().includes(qRaw);

                        return plateSpaced.includes(qRaw) ||
                               plateCompact.includes(qCompact) ||
                               lettersOnly.includes(qCompact) ||
                               wordMatch ||
                               reasonMatch;
                    });

                    metaLine.innerHTML = qRaw === ''
                        ? `<span>Всего в коллекции: <strong>${collectionList.length}</strong></span>`
                        : `<span>Найдено номеров: <strong>${filtered.length}</strong> из ${collectionList.length}</span>`;

                    if (filtered.length === 0) {
                        cardsContainer.innerHTML = '<div class="empty-state">По вашему запросу ничего не найдено.</div>';
                        return;
                    }

                    filtered.forEach(item => {
                        const card = document.createElement('div');
                        card.className = 'garage-card';
                        const isUKItem = item.region === 'UK';
                        const miniPlateHTML = isUKItem ? `
                            <div class="mini-plate is-uk-mini">
                                <div class="mini-uk-strip">UK</div>
                                <div class="mini-plate-main">
                                    <span class="mini-letter ${item.goldL1 ? 'gold-part' : ''}">${item.letters[0]}</span>
                                    <span class="mini-digits ${item.goldDigits ? 'gold-part' : ''}">${item.digits}</span>
                                    <span class="mini-letter ${item.goldL2 ? 'gold-part' : ''}">${item.letters[1]}</span>
                                    <span class="mini-letter ${item.goldL3 ? 'gold-part' : ''}">${item.letters[2]}</span>
                                </div>
                            </div>
                        ` : `
                            <div class="mini-plate">
                                <div class="mini-plate-main">
                                    <span class="mini-letter ${item.goldL1 ? 'gold-part' : ''}">${item.letters[0]}</span>
                                    <span class="mini-digits ${item.goldDigits ? 'gold-part' : ''}">${item.digits}</span>
                                    <span class="mini-letter ${item.goldL2 ? 'gold-part' : ''}">${item.letters[1]}</span>
                                    <span class="mini-letter ${item.goldL3 ? 'gold-part' : ''}">${item.letters[2]}</span>
                                </div>
                                <div class="mini-divider"></div>
                                <div class="mini-region-box">
                                    <span class="mini-region ${item.goldRegion ? 'gold-part' : ''}">${item.region}</span>
                                    <span class="mini-rus">RUS</span>
                                </div>
                            </div>
                        `;

                        const formattedWord = item.word.toUpperCase();
                        const plateText = isUKItem
                            ? `UK ${item.letters} ${item.digits} ${item.letters}${item.letters}`
                            : `${item.letters} ${item.digits} ${item.letters}${item.letters} ${item.region} RUS`;

                        card.innerHTML = `
                            <div class="garage-card-top">
                                ${miniPlateHTML}
                                <div class="garage-word-info">
                                    <div class="garage-word">${item.word}</div>
                                    <div class="garage-points">+${item.points} л</div>
                                </div>
                            </div>
                            <div class="garage-footer-row">
                                <div class="garage-reason">&#9733; ${item.reason}</div>
                                <button type="button" class="btn-share-plate" title="Поделиться достижением">&#128228; Поделиться</button>
                            </div>
                        `;

                        const shareBtn = card.querySelector('.btn-share-plate');
                        shareBtn.addEventListener('click', () => {
                            shareCollectedPlate(plateText, formattedWord, item.points, shareBtn);
                        });

                        cardsContainer.appendChild(card);
                    });
                };

                searchInput.addEventListener('input', (e) => {
                    collectionSearchQuery = e.target.value;
                    clearBtn.classList.toggle('visible', collectionSearchQuery.length > 0);
                    renderFilteredPlates();
                });

                clearBtn.addEventListener('click', () => {
                    collectionSearchQuery = '';
                    searchInput.value = '';
                    clearBtn.classList.remove('visible');
                    renderFilteredPlates();
                    searchInput.focus();
                });

                renderFilteredPlates();
            } else {

                // Вкладка «Атлас регионов»
                const openedStats = getOpenedRegionsStats();
                const uniqueRegions = [];
                const seenImgKeys = new Set();

                Object.keys(REGION_INFO).forEach(code => {
                    const info = REGION_INFO[code];
                    if (!seenImgKeys.has(info.img)) {
                        seenImgKeys.add(info.img);
                        uniqueRegions.push({
                            code: info.img,
                            name: info.name,
                            wordsCount: openedStats[info.img] || 0
                        });
                    }
                });

                // Сортируем: сначала открытые регионы, затем по коду
                uniqueRegions.sort((a, b) => {
                    if ((a.wordsCount > 0) !== (b.wordsCount > 0)) {
                        return b.wordsCount - a.wordsCount;
                    }
                    return Number(a.code) - Number(b.code);
                });

                const unlockedCount = uniqueRegions.filter(r => r.wordsCount > 0).length;
                const percent = Math.round((unlockedCount / uniqueRegions.length) * 100);

                const summaryBar = document.createElement('div');
                summaryBar.className = 'atlas-summary-bar';
                summaryBar.innerHTML = `
                    <div class="atlas-summary-top">
                        <span>Открыто регионов России:</span>
                        <strong>${unlockedCount} из ${uniqueRegions.length} (${percent}%)</strong>
                    </div>
                    <div class="rank-bar-track">
                        <div class="rank-bar-fill" style="width: ${percent}%;"></div>
                    </div>
                `;
                elCollectionModalBody.appendChild(summaryBar);

                const grid = document.createElement('div');
                grid.className = 'atlas-grid';

                uniqueRegions.forEach(reg => {
                    const isUnlocked = reg.wordsCount > 0;
                    const card = document.createElement('div');
                    card.className = `atlas-card ${isUnlocked ? 'is-unlocked' : 'is-locked'}`;
                    card.innerHTML = `
                        <div class="atlas-card-header">
                            <span class="atlas-code-badge">${reg.code} RUS</span>
                            <span class="atlas-status-icon">${isUnlocked ? '&#9989;' : '&#128274;'}</span>
                        </div>
                        <div>
                            <div class="atlas-region-name">${reg.name}</div>
                            <div class="atlas-words-count">${isUnlocked ? `Слов угадано: ${reg.wordsCount}` : 'Ещё не посещён'}</div>
                        </div>
                    `;

                    // Если регион открыт — подгружаем превью его фотографии из папки regions/
                    if (isUnlocked) {
                        const exts = ['jpg', 'jpeg', 'png', 'webp'];
                        let extIdx = 0;
                        const probePhoto = () => {
                            if (extIdx >= exts.length) return;
                            const url = `regions/${reg.code}.${exts[extIdx]}`;
                            const img = new Image();
                            img.onload = () => {
                                card.style.backgroundImage = `url('${url}')`;
                                card.classList.add('has-photo');
                            };
                            img.onerror = () => {
                                extIdx++;
                                probePhoto();
                            };
                            img.src = url;
                        };
                        probePhoto();
                    }

                    grid.appendChild(card);
                });

                elCollectionModalBody.appendChild(grid);
            }
        }

        async function shareCollectedPlate(plateText, wordUpper, points, btnEl) {
            const shareText = `Автослова: на номере ${plateText} я угадал слово «${wordUpper}» (+${points} л)! Давай со мной!`;

            if (vkBridgeReady && window.vkBridge) {
                try {
                    await window.vkBridge.send('VKWebAppShowWallPostBox', {
                        message: shareText
                    });
                    return;
                } catch (e) {
                    // Если пользователь закрыл окно поста, пробуем скопировать в буфер
                }
            }

            if (navigator.share) {
                try {
                    await navigator.share({
                        title: 'Автослова: Слово по номеру',
                        text: shareText
                    });
                    return;
                } catch (e) {
                    if (e && e.name === 'AbortError') return;
                }
            }

            try {
                await navigator.clipboard.writeText(shareText);
            } catch (e) {
                const tmp = document.createElement('textarea');
                tmp.value = shareText;
                tmp.style.position = 'fixed';
                tmp.style.opacity = '0';
                document.body.appendChild(tmp);
                tmp.select();
                document.execCommand('copy');
                document.body.removeChild(tmp);
            }

            SoundFX.hint();
            if (btnEl) {
                const origHTML = btnEl.innerHTML;
                btnEl.classList.add('is-copied');
                btnEl.innerHTML = '&#10003; Скопировано';
                setTimeout(() => {
                    btnEl.classList.remove('is-copied');
                    btnEl.innerHTML = origHTML;
                }, 2000);
            }
        }

        elTabColPlatesBtn.addEventListener('click', () => {
            activeCollectionTab = 'plates';
            renderCollectionContent();
        });

        elTabColAtlasBtn.addEventListener('click', () => {
            activeCollectionTab = 'atlas';
            renderCollectionContent();
        });

        function openCollectionModal() {
            renderCollectionContent();
            elCollectionModal.classList.add('open');
        }


        function closeCollectionModal() {
            elCollectionModal.classList.remove('open');
        }

        elCollectionBtn.addEventListener('click', openCollectionModal);
        elCloseCollectionX.addEventListener('click', closeCollectionModal);
        elCollectionModal.addEventListener('click', (e) => {
            if (e.target === elCollectionModal) closeCollectionModal();
        });

        // Покупка или выбор стиля номерного знака
        window.handleShopSkinAction = function(skinId) {
            const skin = PLATE_SKINS.find(s => s.id === skinId);
            if (!skin) return;

            const isOwned = ownedSkins.includes(skin.id);
            if (isOwned) {
                equippedSkin = skin.id;
                saveProgress();
                applyPlateSkinClass();
                renderShopContent();
                SoundFX.flip();
                return;
            }

            if (score < skin.price) return;

            score -= skin.price;
            ownedSkins.push(skin.id);
            equippedSkin = skin.id;

            saveProgress();
            updateStatsUI();
            applyPlateSkinClass();
            renderShopContent();
            SoundFX.golden();
        };

        window.switchShopTab = function(tabName) {
            activeShopTab = tabName;
            renderShopContent();
        };

        window.buyConsumable = function(type) {
            if (type === 'shield') {
                const price = 200;
                if (score < price) return;
                score -= price;
                streakShields++;
            } else if (type === 'magnet') {
                const price = 550;
                if (score < price) return;
                score -= price;
                goldenMagnetCharges += 3;
            } else if (type === 'region') {
                const price = 300;
                if (score < price || gameMode === 'uk') return;
                const sel = document.getElementById('shopRegionSelect');
                if (!sel || !sel.value) return;
                score -= price;
                orderedRegionCode = sel.value;
            }

            saveProgress();
            updateStatsUI();
            renderShopContent();
            SoundFX.golden();
        };

        // Модальное окно Автомагазина
        function renderShopContent() {
            const negClass = score < 0 ? 'negative' : '';

            if (!GAME_FEATURES.enableConsumables) {
                activeShopTab = 'skins';
            }

            let bodySectionHTML = '';
            if (activeShopTab === 'skins') {
                const visibleSkins = PLATE_SKINS.filter(skin => !GAME_FEATURES.hiddenSkinIds.includes(skin.id));
                const cardsHTML = visibleSkins.map(skin => {
                    const isOwned = ownedSkins.includes(skin.id);
                    const isEquipped = equippedSkin === skin.id;
                    const canAfford = score >= skin.price;


                    let btnHTML = '';
                    if (isEquipped) {
                        btnHTML = `<button type="button" class="btn-shop-action btn-shop-equipped" disabled>&#10003; Установлен</button>`;
                    } else if (isOwned) {
                        btnHTML = `<button type="button" class="btn-shop-action btn-shop-equip" onclick="handleShopSkinAction('${skin.id}')">Выбрать</button>`;
                    } else {
                        btnHTML = `<button type="button" class="btn-shop-action btn-shop-buy" ${canAfford ? '' : 'disabled'} onclick="handleShopSkinAction('${skin.id}')">${formatNumber(skin.price)} л</button>`;
                    }

                    return `
                        <div class="shop-item-card ${isEquipped ? 'is-equipped' : ''}">
                            <div class="shop-item-left">
                                <div class="shop-skin-preview ${skin.previewClass}">А777АА</div>
                                <div class="shop-item-info">
                                    <span class="shop-item-name">${skin.name}</span>
                                    <span class="shop-item-desc">${skin.desc}</span>
                                </div>
                            </div>
                            ${btnHTML}
                        </div>
                    `;
                }).join('');

                bodySectionHTML = `
                    <div class="shop-section-title">Оформление номерного знака</div>
                    <div class="shop-grid">${cardsHTML}</div>
                `;
            } else {
                // Уникальный список регионов из REGION_INFO для заказа
                const uniqueRegions = [];
                const seenNames = new Set();
                Object.keys(REGION_INFO).forEach(code => {
                    const info = REGION_INFO[code];
                    if (!seenNames.has(info.name)) {
                        seenNames.add(info.name);
                        uniqueRegions.push({ code, name: info.name });
                    }
                });

                const regionOptionsHTML = uniqueRegions
                    .map(r => `<option value="${r.code}">${r.code} — ${r.name}</option>`)
                    .join('');

                const regionCardHTML = gameMode === 'ru' ? `
                    <div class="shop-item-card">
                        <div class="shop-item-left">
                            <div class="shop-consumable-icon">&#128205;</div>
                            <div class="shop-item-info">
                                <span class="shop-item-name">Заказ региона</span>
                                <span class="shop-item-desc">Следующий номер выпадет с выбранным регионом</span>
                                <select id="shopRegionSelect" class="shop-region-select">${regionOptionsHTML}</select>
                                ${orderedRegionCode ? `<span class="shop-owned-pill">Заказан регион: ${orderedRegionCode}</span>` : ''}
                            </div>
                        </div>
                        <button type="button" class="btn-shop-action btn-shop-buy" ${score >= 300 ? '' : 'disabled'} onclick="buyConsumable('region')">300 л</button>
                    </div>
                ` : '';

                bodySectionHTML = `
                    <div class="shop-section-title">Полезные расходники</div>
                    <div class="shop-grid">
                        <div class="shop-item-card">
                            <div class="shop-item-left">
                                <div class="shop-consumable-icon">&#128737;</div>
                                <div class="shop-item-info">
                                    <span class="shop-item-name">Страховка серии</span>
                                    <span class="shop-item-desc">Сохранит серию «Слов подряд» при пропуске номера</span>
                                    ${streakShields > 0 ? `<span class="shop-owned-pill">В наличии: ${streakShields} шт.</span>` : ''}
                                </div>
                            </div>
                            <button type="button" class="btn-shop-action btn-shop-buy" ${score >= 200 ? '' : 'disabled'} onclick="buyConsumable('shield')">200 л</button>
                        </div>

                        <div class="shop-item-card">
                            <div class="shop-item-left">
                                <div class="shop-consumable-icon">&#129522;</div>
                                <div class="shop-item-info">
                                    <span class="shop-item-name">Магнит красивых номеров</span>
                                    <span class="shop-item-desc">Следующие 3 номера гарантированно выпадут с бонусом x2</span>
                                    ${goldenMagnetCharges > 0 ? `<span class="shop-owned-pill">Активно ходов: ${goldenMagnetCharges}</span>` : ''}
                                </div>
                            </div>
                            <button type="button" class="btn-shop-action btn-shop-buy" ${score >= 550 ? '' : 'disabled'} onclick="buyConsumable('magnet')">550 л</button>
                        </div>

                        ${regionCardHTML}
                    </div>
                `;

            }

            const shopTabsHTML = GAME_FEATURES.enableConsumables ? `
                <div class="shop-tabs">
                    <button type="button" class="tab-btn ${activeShopTab === 'skins' ? 'active' : ''}" onclick="switchShopTab('skins')">Тюнинг знака</button>
                    <button type="button" class="tab-btn ${activeShopTab === 'consumables' ? 'active' : ''}" onclick="switchShopTab('consumables')">Расходники</button>
                </div>
            ` : '';

            const rewardBannerHTML = GAME_FEATURES.enableRewardAd ? `
                <div class="shop-reward-banner">
                    <div class="shop-reward-info">
                        <span class="shop-reward-title">&#9981; Бесплатная заправка</span>
                        <span class="shop-reward-desc">Посмотрите короткий ролик и получите +200 л</span>
                    </div>
                    <button type="button" class="btn-reward-ad" onclick="watchAdForFuel()">&#9654; +200 л</button>
                </div>
            ` : '';

            elShopModalBody.innerHTML = `
                <div class="shop-balance-bar">
                    <span>Ваш запас бензина:</span>
                    <span class="shop-balance-val ${negClass}">${formatNumber(score)} л</span>
                </div>
                ${rewardBannerHTML}
                ${shopTabsHTML}
                ${bodySectionHTML}
            `;
        }

        window.watchAdForFuel = async function() {
            const grantFuelReward = () => {
                score += 200;
                saveProgress();
                updateStatsUI();
                if (elShopModal.classList.contains('open')) {
                    renderShopContent();
                }
                SoundFX.golden();
                showStatus('Заправка завершена! Начислено +200 л бензина.', 'success');
            };

            if (vkBridgeReady && window.vkBridge) {
                try {
                    isAdPlaying = true;
                    const data = await window.vkBridge.send('VKWebAppShowNativeAds', {
                        ad_format: 'reward'
                    });
                    isAdPlaying = false;

                    if (data && data.result) {
                        grantFuelReward();
                    } else {
                        showStatus('Просмотр рекламы не был завершён.', 'warning');
                    }
                } catch (e) {
                    isAdPlaying = false;
                    showStatus('Видеореклама сейчас недоступна. Попробуйте чуть позже.', 'warning');
                }
            } else {
                // Локальный тест вне ВКонтакте
                grantFuelReward();
            }
        };



        function openShopModal() {
            renderShopContent();
            elShopModal.classList.add('open');
        }

        function closeShopModal() {
            elShopModal.classList.remove('open');
        }

        elShopBtn.addEventListener('click', openShopModal);
        elCloseShopX.addEventListener('click', closeShopModal);
        elShopModal.addEventListener('click', (e) => {
            if (e.target === elShopModal) closeShopModal();
        });

        // Модальное окно Карты званий и транспорта
        function loadRankItemSprite(level, imgEl, fallbackEl) {
            const baseNames = gameMode === 'uk' ? [`uk_${level}`, `${level}`] : [`${level}`];
            const extensions = ['png', 'svg', 'webp', 'gif', 'jpg'];
            const candidates = [];
            baseNames.forEach(name => {
                extensions.forEach(ext => candidates.push(`models/${name}.${ext}`));
            });

            let idx = 0;
            const tryNext = () => {
                if (idx >= candidates.length) return;
                const url = candidates[idx];
                const probe = new Image();
                probe.onload = () => {
                    imgEl.src = url;
                    imgEl.style.display = 'block';
                    fallbackEl.style.display = 'none';
                };
                probe.onerror = () => {
                    idx++;
                    tryNext();
                };
                probe.src = url;
            };
            tryNext();
        }

        function renderRanksModalContent() {
            elRanksModalBody.innerHTML = '';
            const list = gameMode === 'uk' ? RANKS_UK : RANKS_RU;
            const wordsCount = historyList.length;
            const currentStatus = getRankStatus(wordsCount);

            list.forEach((rank, idx) => {
                const level = idx + 1;
                const isUnlocked = wordsCount >= rank.minWords;
                const isCurrent = level === currentStatus.level;

                const row = document.createElement('div');
                row.className = `rank-list-item ${isCurrent ? 'is-current' : ''} ${!isUnlocked ? 'is-locked' : ''}`;

                let statusHTML = '';
                if (isCurrent) {
                    statusHTML = `<span class="rank-item-status active">Текущий</span>`;
                } else if (isUnlocked) {
                    statusHTML = `<span class="rank-item-status done">&#10003; Открыто</span>`;
                } else {
                    const left = rank.minWords - wordsCount;
                    statusHTML = `<span class="rank-item-status locked">&#128274; Ещё ${formatNumber(left)}</span>`;
                }

                const reqText = rank.minWords === 0
                    ? 'Стартовое звание (0 слов)'
                    : `Требуется слов: ${formatNumber(rank.minWords)}`;

                row.innerHTML = `
                    <div class="rank-item-left">
                        <div class="rank-model-box">
                            <img class="rank-model-img" alt="" style="display:none;">
                            <span class="rank-model-emoji">${rank.icon}</span>
                        </div>
                        <div class="rank-item-info">
                            <span class="rank-item-title">${level}. ${rank.title}</span>
                            <span class="rank-item-req">${reqText}</span>
                        </div>
                    </div>
                    ${statusHTML}
                `;

                elRanksModalBody.appendChild(row);

                const imgEl = row.querySelector('.rank-model-img');
                const fallbackEl = row.querySelector('.rank-model-emoji');
                loadRankItemSprite(level, imgEl, fallbackEl);
            });
        }

        function openRanksModal() {
            renderRanksModalContent();
            elRanksModal.classList.add('open');
        }

        function closeRanksModal() {
            elRanksModal.classList.remove('open');
        }

        elRankProgressCard.addEventListener('click', openRanksModal);
        elCloseRanksX.addEventListener('click', closeRanksModal);
        elRanksModal.addEventListener('click', (e) => {
            if (e.target === elRanksModal) closeRanksModal();
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (elRulesModal.classList.contains('open')) closeRulesModal();
                if (elHistoryModal.classList.contains('open')) closeHistoryModal();
                if (elCollectionModal.classList.contains('open')) closeCollectionModal();
                if (elShopModal.classList.contains('open')) closeShopModal();
                if (elRanksModal.classList.contains('open')) closeRanksModal();
            }
        });



        // Тестовый авто-подбор верного слова для проверки прогрессии и поздних этапов
        elAutoWinTestBtn.addEventListener('click', () => {
            const dict = getActiveDictionary();
            if (dict.size === 0) {
                showStatus('[Тест] Сначала дождитесь загрузки словаря.', 'error');
                return;
            }

            let foundWord = currentHintWord && !usedWordsSet.has(currentHintWord) ? currentHintWord : null;

            if (!foundWord) {
                for (const word of dict) {
                    if (!usedWordsSet.has(word) && checkLettersOrder(word, currentPlate.letters)) {
                        foundWord = word;
                        break;
                    }
                }
            }

            if (!foundWord) {
                showStatus('[Тест] Подходящих новых слов в словаре для этого номера не осталось.', 'warning');
                return;
            }

            elWordInput.value = foundWord;
            updateLiveLetterIndicators(false);
            handleCheckWord();
        });

        // Тестовое начисление бензина для проверки магазина
        elAddFuelTestBtn.addEventListener('click', () => {
            score += 10000;
            saveProgress();
            updateStatsUI();
            if (elShopModal.classList.contains('open')) {
                renderShopContent();
            }
            SoundFX.golden();
            showStatus('[Тест] Начислено +10 000 л бензина.', 'success');
        });


        function resetCurrentModeProgress() {
            localStorage.removeItem(getProgressStorageKey());
            if (gameMode === 'ru') {
                localStorage.removeItem(STORAGE_KEY_RULES_SEEN);
            }
            location.reload();
        }

        // Пользовательский сброс прогресса из окна «Правила игры»
        if (elResetProgressRulesBtn) {
            elResetProgressRulesBtn.addEventListener('click', () => {
                if (confirm('Вы уверены, что хотите сбросить весь игровой прогресс, запас бензина и коллекцию номеров? Это действие нельзя отменить.')) {
                    resetCurrentModeProgress();
                }
            });
        }

        // Тестовый сброс игрового прогресса текущего режима
        elResetTestBtn.addEventListener('click', resetCurrentModeProgress);




        // Работа с IndexedDB для кэширования словаря
        function openDictDB() {
            return new Promise((resolve, reject) => {
                const request = indexedDB.open(DB_NAME, 1);
                request.onupgradeneeded = (e) => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains(DB_STORE)) {
                        db.createObjectStore(DB_STORE);
                    }
                };
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        }

                async function getCachedDictionary(mode = gameMode) {
            try {
                const db = await openDictDB();
                return new Promise((resolve) => {
                    const tx = db.transaction(DB_STORE, 'readonly');
                    const store = tx.objectStore(DB_STORE);
                    const req = store.get(getDictDBKey(mode));
                    req.onsuccess = () => resolve(req.result || null);
                    req.onerror = () => resolve(null);
                });
            } catch (e) {
                return null;
            }
}

        async function saveDictionaryToCache(wordsArray, mode = gameMode) {
            try {
                const db = await openDictDB();
                return new Promise((resolve) => {
                    const tx = db.transaction(DB_STORE, 'readwrite');
                    const store = tx.objectStore(DB_STORE);
                    store.put(wordsArray, getDictDBKey(mode));
                    tx.oncomplete = () => resolve(true);
                    tx.onerror = () => resolve(false);
                });
            } catch (e) {
                return false;
            }
}

        function updateDictStatsLabel(mode = gameMode) {
            const dict = dictionaries[mode];
            const langLabel = mode === 'uk' ? 'английском' : 'русском';
            if (dict.size > 0) {
                elDictStatsInRules.textContent = `В ${langLabel} словаре загружено слов: ${formatNumber(dict.size)}`;
            }
}

        function parseAndPopulateDictionary(text, mode = gameMode) {
            const splitter = mode === 'uk' ? /[^a-z]+/ : /[^а-яё]+/;
            const rawWords = text.toLowerCase().split(splitter);
            const targetSet = dictionaries[mode];
            targetSet.clear();

            for (let i = 0; i < rawWords.length; i++) {
                if (rawWords[i].length >= 3) {
                    targetSet.add(rawWords[i]);
                }
            }
            if (mode === gameMode) {
                updateDictStatsLabel(mode);
            }
            return Array.from(targetSet);
}

// Автоматическая загрузка russian.txt или english.txt из папки с игрой
        // Автоматическая загрузка russian.txt или english.txt из папки с игрой
        async function initDictionary(mode = gameMode, forceReload = false) {
            elFolderPermissionBar.classList.remove('visible');

            if (!forceReload) {
                if (dictionaries[mode].size > 0) {
                    updateDictStatsLabel(mode);
                    return true;
                }

                const cached = await getCachedDictionary(mode);
                if (cached && Array.isArray(cached) && cached.length > 0) {
                    dictionaries[mode] = new Set(cached);
                    updateDictStatsLabel(mode);
                    return true;
                }
            }

            const fileName = mode === 'uk' ? 'english.txt' : 'russian.txt';
            const cacheBuster = forceReload ? `?t=${Date.now()}` : '';

            try {
                const response = await fetch(`./${fileName}${cacheBuster}`, { cache: 'no-store' });
                if (!response.ok) throw new Error('HTTP error');
                const text = await response.text();
                const arr = parseAndPopulateDictionary(text, mode);
                await saveDictionaryToCache(arr, mode);
                return true;
            } catch (e) {
                try {
                    const text = await new Promise((resolve, reject) => {
                        const xhr = new XMLHttpRequest();
                        xhr.open('GET', `./${fileName}${cacheBuster}`, true);

                        xhr.overrideMimeType('text/plain; charset=utf-8');
                        xhr.onload = () => {
                            if (xhr.status === 200 || (xhr.status === 0 && xhr.responseText)) {
                                resolve(xhr.responseText);
                            } else {
                                reject();
                            }
                        };
                        xhr.onerror = reject;
                        xhr.send();
                    });
                    const arr = parseAndPopulateDictionary(text, mode);
                    await saveDictionaryToCache(arr, mode);
                    return true;
                } catch (xhrErr) {
                    elDictStatsInRules.textContent = `Словарь ожидает подключения папки с файлом ${fileName}`;
                    elFolderPermissionText.textContent = `Укажите папку с игрой для загрузки словаря (${fileName}):`;
                    elFolderPermissionBar.classList.add('visible');
                    return false;
                }
            }
        }

        elReloadDictBtn.addEventListener('click', async () => {
            const fileName = gameMode === 'uk' ? 'english.txt' : 'russian.txt';
            elReloadDictBtn.disabled = true;
            elDictStatsInRules.textContent = `Перечитываем ${fileName}...`;

            const ok = await initDictionary(gameMode, true);
            elReloadDictBtn.disabled = false;

            if (ok) {
                SoundFX.hint();
            } else {
                // Если браузер блокирует прямой fetch (file://), сразу открываем выбор папки/файла
                elGrantFolderBtn.click();
            }
        });


        elGrantFolderBtn.addEventListener('click', async () => {
            const fileName = gameMode === 'uk' ? 'english.txt' : 'russian.txt';
            try {
                if (window.showDirectoryPicker) {
                    const dirHandle = await window.showDirectoryPicker();
                    const fileHandle = await dirHandle.getFileHandle(fileName);
                    const file = await fileHandle.getFile();
                    const text = await file.text();
                    const arr = parseAndPopulateDictionary(text, gameMode);
                    await saveDictionaryToCache(arr, gameMode);
                    elFolderPermissionBar.classList.remove('visible');
                    hideStatus();
                } else {
                    const inp = document.createElement('input');
                    inp.type = 'file';
                    inp.accept = '.txt';
                    inp.onchange = async (ev) => {
                        const f = ev.target.files[0];
                        if (!f) return;
                        const text = await f.text();
                        const arr = parseAndPopulateDictionary(text, gameMode);
                        await saveDictionaryToCache(arr, gameMode);
                        elFolderPermissionBar.classList.remove('visible');
                        hideStatus();
                    };
                    inp.click();
                }
            } catch (err) {
                // Пользователь отменил выбор
            }
});

        function applyReleaseFeatureVisibility() {
            if (!GAME_FEATURES.enableUKMode && elLangModeBtn) {
                elLangModeBtn.style.display = 'none';
            }
            const devRow = document.querySelector('.dev-test-row');
            if (!GAME_FEATURES.enableDevTools && devRow) {
                devRow.style.display = 'none';
            }
        }

        // Инициализация VK Bridge SDK
        async function initVKBridge() {
            if (window.vkBridge && typeof window.vkBridge.send === 'function') {
                try {
                    await window.vkBridge.send('VKWebAppInit');
                    vkBridgeReady = true;
                    // Просим ВКонтакте выделить комфортную высоту окна для игры
                    window.vkBridge.send('VKWebAppResizeWindow', { width: 800, height: 760 }).catch(() => {});
                    // Предзагружаем рекламный ролик заранее, чтобы он открывался мгновенно
                    window.vkBridge.send('VKWebAppCheckNativeAds', { ad_format: 'reward' }).catch(() => {});
                } catch (e) {
                    vkBridgeReady = false;
                }
            }
        }

        // Отключаем контекстное меню на игровых элементах
        document.addEventListener('contextmenu', (e) => {
            if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
                e.preventDefault();
            }
        });

        // Запускаем инициализацию VK Bridge сразу при загрузке скрипта
        initVKBridge();

        // Инициализация при старте
        window.addEventListener('DOMContentLoaded', async () => {
            applyReleaseFeatureVisibility();
            loadProgress();
            await initDictionary(gameMode);

            if (!currentHintWord && getActiveDictionary().size > 0 && !hasEnoughSolutions(currentPlate.letters, 5)) {
                generateNewPlateData();
                saveProgress();
                renderPlate(false);
            }

            if (!localStorage.getItem(STORAGE_KEY_RULES_SEEN)) {
                openRulesModal();
            } else {
                elWordInput.focus();
            }
        });


