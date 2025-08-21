document.addEventListener('DOMContentLoaded', () => {
    // --- Socket & Constants ---
    const SERVER_ADDRESS = window.location.origin || "http://localhost:3001";
    const socket = io(SERVER_ADDRESS);

    // --- State ---
    let currentPin = '';
    let isHost = false;
    let timerInterval;
    let currentEditQuizId = null;
    let questionCount = 0;

    // --- Audio ---
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    function unlockAudio() {
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume().catch(e => console.error("Không thể resume AudioContext:", e));
        }
    }

    async function playSound(type) {
        if (!audioCtx) return;
        unlockAudio(); 
        
        if (type === 'applause') {
            if (fireworksSound) {
                fireworksSound.currentTime = 0;
                fireworksSound.play();
            }
            return;
        }

        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        gainNode.gain.setValueAtTime(0.08, audioCtx.currentTime);
        if (type === 'correct') { oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(523.25, audioCtx.currentTime); }
        else if (type === 'incorrect') { oscillator.type = 'square'; oscillator.frequency.setValueAtTime(150, audioCtx.currentTime); }
        oscillator.start(audioCtx.currentTime);
        oscillator.stop(audioCtx.currentTime + 0.25);
    }

    // --- Screens ---
    const screens = {
        home: document.getElementById('homeScreen'),
        library: document.getElementById('libraryScreen'),
        editQuiz: document.getElementById('editQuizScreen'),
        hostLobby: document.getElementById('hostLobbyScreen'),
        playerJoin: document.getElementById('playerJoinScreen'),
        playerLobby: document.getElementById('playerLobbyScreen'),
        question: document.getElementById('questionScreen'),
        result: document.getElementById('resultScreen'),
        leaderboard: document.getElementById('leaderboardScreen'),
        gameOver: document.getElementById('gameOverScreen')
    };

    // --- Elements ---
    const allButtons = document.querySelectorAll('button');
    const connectionStatusDiv = document.getElementById('connectionStatus');
    const appHeader = document.getElementById('appHeader');
    const goPlayerBtn = document.getElementById('goPlayerBtn');
    const goLibraryBtn = document.getElementById('goLibraryBtn');
    const goCreateQuizBtn = document.getElementById('goCreateQuizBtn');
    const backToHomeBtn = document.getElementById('backToHomeBtn');
    const backFromEditBtn = document.getElementById('backFromEditBtn');
    const backToHomeFromGameOverBtn = document.getElementById('backToHomeFromGameOverBtn');
    const quizListDiv = document.getElementById('quizList');
    const editQuizTitle = document.getElementById('editQuizTitle');
    const quizTitleInput = document.getElementById('quizTitleInput');
    const questionsContainer = document.getElementById('questionsContainer');
    const addQuestionBtn = document.getElementById('addQuestionBtn');
    const saveChangesBtn = document.getElementById('saveChangesBtn');
    const saveAsCopyBtn = document.getElementById('saveAsCopyBtn');
    const editStatus = document.getElementById('editStatus');
    const pinDisplay = document.getElementById('pinDisplay');
    const playerListUl = document.querySelector('#hostLobbyScreen #playerList ul');
    const startGameBtn = document.getElementById('startGameBtn');
    const backFromHostLobbyBtn = document.getElementById('backFromHostLobbyBtn');
    const pinInput = document.getElementById('pinInput');
    const nicknameInput = document.getElementById('nicknameInput');
    const joinBtn = document.getElementById('joinBtn');
    const backFromPlayerJoinBtn = document.getElementById('backFromPlayerJoinBtn');
    const errorMessage = document.getElementById('errorMessage');
    const questionText = document.getElementById('questionText');
    const answerOptions = document.getElementById('answerOptions');
    const timerBar = document.getElementById('timerBar');
    const resultText = document.getElementById('resultText');
    const playerScore = document.getElementById('playerScore');
    const leaderboardTableBody = document.querySelector('#leaderboardTable tbody');
    const nextQuestionBtn = document.getElementById('nextQuestionBtn');
    const podiumOl = document.getElementById('podium');
    const confettiCanvas = document.getElementById('confettiCanvas');
    const confettiInstance = confetti.create(confettiCanvas, { resize: true });
    const answerStatsDiv = document.getElementById('answerStats');
    const questionMediaContainer = document.getElementById('questionMediaContainer');
    const backgroundMusic = document.getElementById('backgroundMusic');
    const muteBtn = document.getElementById('muteBtn');
    const fireworksSound = document.getElementById('fireworksSound');
    if(backgroundMusic) {
        backgroundMusic.volume = 0.2;
        backgroundMusic.muted = false;
    }

    async function playMusic() {
        unlockAudio();
        if (backgroundMusic && backgroundMusic.paused) {
            try {
                await backgroundMusic.play();
            } catch (err) {
                console.error("Lỗi khi phát nhạc nền (trình duyệt có thể đã chặn):", err);
            }
        }
    }
    function stopMusic() {
        if(backgroundMusic){
            backgroundMusic.pause();
            backgroundMusic.currentTime = 0;
        }
    }

    // --- Connection Status ---
    socket.on('connect', () => {
        connectionStatusDiv.innerText = `✅ Đã kết nối tới server!`;
        connectionStatusDiv.style.backgroundColor = '#66BB6A';
        setTimeout(() => { connectionStatusDiv.style.opacity = '0'; connectionStatusDiv.style.pointerEvents = 'none'; }, 2500);
    });
    socket.on('disconnect', () => {
        connectionStatusDiv.style.opacity = '1'; connectionStatusDiv.style.pointerEvents = 'auto';
        connectionStatusDiv.innerText = `❌ Mất kết nối tới server!`; connectionStatusDiv.style.backgroundColor = '#EF5350';
    });
    socket.on('connect_error', (err) => {
        connectionStatusDiv.style.opacity = '1'; connectionStatusDiv.style.pointerEvents = 'auto';
        connectionStatusDiv.innerText = `❌ Lỗi kết nối: ${err.message}. Kiểm tra địa chỉ server và tường lửa.`;
        connectionStatusDiv.style.backgroundColor = '#EF5350';
    });
    
    // --- Helpers ---
    function showScreen(screenName) {
        if (appHeader) {
            appHeader.style.opacity = (screenName === 'home') ? '1' : '0';
            appHeader.style.pointerEvents = (screenName === 'home') ? 'auto' : 'none';
        }
        for (let key in screens) { if (screens[key]) screens[key].classList.remove('active'); }
        if (screens[screenName]) screens[screenName].classList.add('active'); else screens.home.classList.add('active');
    }

    // --- Events ---
    goPlayerBtn.addEventListener('click', () => { unlockAudio(); showScreen('playerJoin'); });
    goLibraryBtn.addEventListener('click', () => { unlockAudio(); loadQuizzes(); showScreen('library'); });
    goCreateQuizBtn.addEventListener('click', () => { unlockAudio(); openEditScreen(null); });
    
    backToHomeBtn.addEventListener('click', () => { stopMusic(); showScreen('home'); });
    backFromEditBtn.addEventListener('click', () => { stopMusic(); showScreen('home'); });
    backFromHostLobbyBtn.addEventListener('click', () => { stopMusic(); socket.emit('host_cancel_room', { gamePin: currentPin }); showScreen('library'); });
    backFromPlayerJoinBtn.addEventListener('click', () => { stopMusic(); showScreen('home'); });
    backToHomeFromGameOverBtn.addEventListener('click', () => { stopMusic(); showScreen('home'); });
    
    joinBtn.addEventListener('click', () => {
        unlockAudio();
        const gamePin = pinInput.value.trim();
        const nickname = nicknameInput.value.trim();
        if (gamePin && nickname) {
            errorMessage.innerText = '';
            currentPin = gamePin;
            socket.emit('player_join_room', { gamePin, nickname });
        } else { errorMessage.innerText = 'Vui lòng nhập đủ mã PIN và biệt danh!'; }
    });
    startGameBtn.addEventListener('click', () => { 
        unlockAudio();
        const shuffle = document.getElementById('shuffleQuestions')?.checked; 
        socket.emit('start_game', { gamePin: currentPin, shuffle }); 
    });
    nextQuestionBtn.addEventListener('click', () => socket.emit('host_next_question', { gamePin: currentPin }));

    muteBtn.addEventListener('click', () => {
        unlockAudio();
        backgroundMusic.muted = !backgroundMusic.muted;
        muteBtn.innerText = backgroundMusic.muted ? '🔇' : '🎵';
    });


    // --- Library & Editor ---
    async function handleApiResponse(response) {
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Lỗi không xác định từ server.');
            return data;
        } else {
            const errorText = await response.text();
            throw new Error('Lỗi server (không phải JSON). Chi tiết: ' + errorText.slice(0, 150));
        }
    }
    async function deleteQuiz(quizId, quizTitle) {
        const confirmed = confirm(`Bạn có chắc chắn muốn xóa bộ câu hỏi "${quizTitle}" không?`);
        if (!confirmed) return;
        try {
            const response = await fetch(`/api/quizzes/${quizId}`, { method: 'DELETE' });
            await handleApiResponse(response);
            loadQuizzes();
        } catch (err) { alert(`Lỗi khi xóa: ${err.message}`); }
    }
    async function loadQuizzes() {
        try {
            const response = await fetch('/api/quizzes');
            const quizzes = await handleApiResponse(response);
            quizListDiv.innerHTML = '';
            if (quizzes.length === 0) { quizListDiv.innerHTML = '<p>Chưa có bộ câu hỏi nào.</p>'; return; }
            quizzes.forEach(quiz => {
                const itemDiv = document.createElement('div');
                itemDiv.className = 'quiz-item';
                const selectBtn = document.createElement('button');
                selectBtn.innerText = quiz.title;
                selectBtn.className = 'quiz-select-btn';
                selectBtn.onclick = () => { isHost = true; socket.emit('host_create_room', { quizId: quiz.id }); showScreen('hostLobby'); };
                const editBtn = document.createElement('button');
                editBtn.innerText = 'Sửa'; editBtn.className = 'edit-quiz-btn';
                editBtn.onclick = () => openEditScreen(quiz.id);
                const deleteBtn = document.createElement('button');
                deleteBtn.innerText = 'Xóa'; deleteBtn.className = 'delete-quiz-btn';
                deleteBtn.onclick = () => deleteQuiz(quiz.id, quiz.title);
                itemDiv.appendChild(selectBtn); itemDiv.appendChild(editBtn); itemDiv.appendChild(deleteBtn);
                quizListDiv.appendChild(itemDiv);
            });
        } catch (err) {
            quizListDiv.innerHTML = `<p style="color: red;">Không thể tải danh sách câu hỏi: ${err.message}</p>`;
        }
    }
    async function openEditScreen(quizId) {
        editStatus.innerText = '';
        answerStatsDiv.innerHTML = '';
        if (quizId) {
            try {
                const response = await fetch(`/api/quizzes/${quizId}`);
                const quiz = await handleApiResponse(response);
                currentEditQuizId = quiz.id;
                editQuizTitle.innerText = "Chỉnh Sửa Bộ Câu Hỏi";
                saveChangesBtn.style.display = 'inline-block';
                saveAsCopyBtn.innerText = "Lưu Thành Bản Sao";
                saveAsCopyBtn.style.display = 'inline-block';
                quizTitleInput.value = quiz.title;
                questionsContainer.innerHTML = '';
                questionCount = 0;
                quiz.questions.forEach(q => addQuestionForm(q));
            } catch (err) { alert(`Không thể tải dữ liệu quiz: ${err.message}`); return; }
        } else {
            currentEditQuizId = null;
            editQuizTitle.innerText = "Tạo Bộ Câu Hỏi Mới";
            saveChangesBtn.style.display = 'none';
            saveAsCopyBtn.innerText = "Lưu Bộ Câu Hỏi";
            saveAsCopyBtn.style.display = 'inline-block';
            quizTitleInput.value = '';
            questionsContainer.innerHTML = '';
            questionCount = 0;
            addQuestionForm();
        }
        showScreen('editQuiz');
    }

    function addQuestionForm(data = {}) {
        questionCount++;
        const questionDiv = document.createElement('div');
        questionDiv.className = 'question-creator';
        questionDiv.innerHTML = `
            <button class="delete-question-btn">X</button>
            <h3>Câu hỏi ${questionCount}</h3>
            <textarea class="question-text-area" placeholder="Nội dung câu hỏi...">${data.questionText || ''}</textarea>
            <input type="text" class="image-url-input" placeholder="URL hình ảnh/GIF (tùy chọn)..." value="${data.imageUrl || ''}">
            <label>Thời gian (giây): <input type="number" class="time-limit-input" value="${data.timeLimit || 20}" min="5" max="120"></label>
            <div class="options-grid"></div>
            <div class="options-editor-controls">
                <button type="button" class="add-option-btn">Thêm đáp án</button>
                <button type="button" class="remove-option-btn">Bớt đáp án</button>
            </div>
        `;
        questionsContainer.appendChild(questionDiv);
        const optionsGrid = questionDiv.querySelector('.options-grid');
        const radioName = `correct_q${questionCount}`;
        function renderOptions() {
            const currentOptions = Array.from(optionsGrid.querySelectorAll('.option')).map(inp => inp.value);
            const checkedRadioValue = optionsGrid.querySelector(`input[name="${radioName}"]:checked`)?.value || '0';
            
            optionsGrid.innerHTML = '';
            currentOptions.forEach((optValue, index) => {
                const optionDiv = document.createElement('div');
                optionDiv.className = 'option-input';
                optionDiv.innerHTML = `
                    <input type="radio" name="${radioName}" value="${index}">
                    <input type="text" class="option" placeholder="Đáp án ${index + 1}" value="${optValue}">
                `;
                optionsGrid.appendChild(optionDiv);
            });
            const radioToSelect = optionsGrid.querySelector(`input[name="${radioName}"][value="${checkedRadioValue}"]`) || optionsGrid.querySelector(`input[name="${radioName}"]`);
            if (radioToSelect) radioToSelect.checked = true;
            updateAddRemoveButtons();
        }
        function updateAddRemoveButtons() {
            const numOptions = optionsGrid.children.length;
            questionDiv.querySelector('.add-option-btn').disabled = numOptions >= 6;
            questionDiv.querySelector('.remove-option-btn').disabled = numOptions <= 2;
        }
        questionDiv.querySelector('.add-option-btn').addEventListener('click', () => {
            if (optionsGrid.children.length < 6) {
                const optionDiv = document.createElement('div');
                optionDiv.className = 'option-input';
                const newIndex = optionsGrid.children.length;
                optionDiv.innerHTML = `
                    <input type="radio" name="${radioName}" value="${newIndex}">
                    <input type="text" class="option" placeholder="Đáp án ${newIndex + 1}" value="">
                `;
                optionsGrid.appendChild(optionDiv);
                updateAddRemoveButtons();
            }
        });
        questionDiv.querySelector('.remove-option-btn').addEventListener('click', () => {
            if (optionsGrid.children.length > 2) {
                const lastOption = optionsGrid.lastElementChild;
                const isChecked = lastOption.querySelector('input[type="radio"]').checked;
                optionsGrid.removeChild(lastOption);
                if (isChecked) {
                    optionsGrid.querySelector('input[type="radio"]').checked = true;
                }
                updateAddRemoveButtons();
            }
        });
        const initialOptions = data.options || ['', '', '', ''];
        initialOptions.forEach(opt => {
            const newIndex = optionsGrid.children.length;
            const optionDiv = document.createElement('div');
            optionDiv.className = 'option-input';
            optionDiv.innerHTML = `
                <input type="radio" name="${radioName}" value="${newIndex}">
                <input type="text" class="option" placeholder="Đáp án ${newIndex + 1}" value="${opt}">
            `;
            optionsGrid.appendChild(optionDiv);
        });
        const correctIndex = data.correctAnswer ? initialOptions.indexOf(data.correctAnswer) : 0;
        const correctRadio = optionsGrid.querySelector(`input[name="${radioName}"][value="${correctIndex > -1 ? correctIndex : 0}"]`);
        if (correctRadio) correctRadio.checked = true;
        updateAddRemoveButtons();
        questionDiv.querySelector('.delete-question-btn').addEventListener('click', () => questionDiv.remove());
    }
    addQuestionBtn.addEventListener('click', () => addQuestionForm());
    function getQuizDataFromForm() {
        const title = quizTitleInput.value.trim();
        if (!title) { alert('Vui lòng nhập tiêu đề!'); return null; }
        const questions = [];
        document.querySelectorAll('.question-creator').forEach((form, index) => {
            const questionText = form.querySelector('.question-text-area').value.trim();
            const imageUrl = form.querySelector('.image-url-input').value.trim();
            const timeLimit = parseInt(form.querySelector('.time-limit-input').value);
            const options = Array.from(form.querySelectorAll('.option')).map(opt => opt.value.trim());
            
            const checkedRadio = form.querySelector('input[type="radio"]:checked');
            if (!checkedRadio) {
                alert(`Câu hỏi ${index + 1} chưa chọn đáp án đúng!`);
                return;
            }
            const correctIndex = parseInt(checkedRadio.value);
            if (questionText && options.length >= 2 && options.every(opt => opt)) {
                const questionData = { questionText, timeLimit, options, correctAnswer: options[correctIndex] };
                if (imageUrl) {
                    questionData.imageUrl = imageUrl;
                }
                questions.push(questionData);
            }
        });
        if (questions.length === 0) { alert('Vui lòng tạo ít nhất một câu hỏi hợp lệ!'); return null; }
        return { title, questions };
    }
    saveAsCopyBtn.addEventListener('click', async () => {
        const quizData = getQuizDataFromForm();
        if (!quizData) return;
        try {
            const response = await fetch('/api/quizzes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(quizData) });
            await handleApiResponse(response);
            editStatus.innerText = 'Lưu thành công!';
            loadQuizzes(); setTimeout(() => showScreen('library'), 1200);
        } catch (err) { editStatus.innerText = `Lỗi: ${err.message}`; }
    });
    saveChangesBtn.addEventListener('click', async () => {
        const quizData = getQuizDataFromForm();
        if (!quizData || !currentEditQuizId) return;
        try {
            const response = await fetch(`/api/quizzes/${currentEditQuizId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(quizData) });
            await handleApiResponse(response);
            editStatus.innerText = 'Cập nhật thành công!';
            loadQuizzes(); setTimeout(() => showScreen('library'), 1200);
        } catch (err) { editStatus.innerText = `Lỗi: ${err.message}`; }
    });
    socket.on('room_created', (data) => { 
        pinDisplay.innerText = data.gamePin; 
        currentPin = data.gamePin; 
        playerListUl.innerHTML=''; 
        playMusic();
    });
    socket.on('update_player_list', (players) => {
        playerListUl.innerHTML = '';
        players.forEach(player => {
            const li = document.createElement('li');
            li.innerText = player.nickname;
            if (isHost) {
                const btn = document.createElement('button');
                btn.innerText = 'X';
                btn.style.marginLeft = '8px';
                btn.onclick = () => socket.emit('host_kick', { gamePin: currentPin, playerId: player.id });
                li.appendChild(btn);
            }
            playerListUl.appendChild(li);
        });
    });
    socket.on('host_error', (msg) => alert(msg || 'Có lỗi khi thao tác của host.'));
    socket.on('join_success', () => { 
        showScreen('playerLobby'); 
        playMusic();
    });
    socket.on('join_error', (data) => errorMessage.innerText = data.message);
    socket.on('kicked', () => { 
        stopMusic();
        alert('Bạn đã bị host mời khỏi phòng.'); 
        showScreen('home'); 
    });
    socket.on('host_disconnected', () => { 
        stopMusic();
        alert("Chủ phòng đã rời đi hoặc hủy phòng. Trò chơi kết thúc."); 
        showScreen('home'); 
    });
    socket.on('new_question', (data) => {
        window.__pendingAnswerResult = null;
        answerStatsDiv.innerHTML = '';
        resultText.className = '';
        resultText.innerText = 'ĐÃ GỬI - Đợi kết quả...';
        
        questionMediaContainer.innerHTML = '';
        if (data.imageUrl) {
            const img = document.createElement('img');
            img.src = data.imageUrl;
            questionMediaContainer.appendChild(img);
        }
        
        questionText.innerText = data.questionText;
        answerOptions.innerHTML = '';
        clearInterval(timerInterval);
        timerBar.style.transition = 'none';
        timerBar.style.width = '100%';
        void timerBar.offsetWidth;
        timerBar.style.transition = `width ${data.timeLimit}s linear`;
        setTimeout(() => { timerBar.style.width = '0%'; }, 50);
        const colorClasses = ['red', 'blue', 'yellow', 'green', 'purple', 'orange'];
        data.options.forEach((option, i) => {
            const btn = document.createElement('button');
            btn.innerText = option;
            btn.classList.add('answer-btn', colorClasses[i % colorClasses.length]);
            if (isHost) {
                btn.classList.add('disabled-host');
            } else {
                btn.addEventListener('click', () => {
                    document.querySelectorAll('.answer-btn').forEach(b => b.classList.add('disabled'));
                    socket.emit('player_answer', { gamePin: currentPin, answer: option });
                    answerOptions.insertAdjacentHTML('beforeend', '<h3>Đã gửi câu trả lời! Hãy chờ mọi người...</h3>');
                });
            }
            answerOptions.appendChild(btn);
        });
        showScreen('question');
    });
    socket.on('answer_result', (data) => {
        window.__pendingAnswerResult = data;
        showScreen('result');
    });
    socket.on('show_answer_stats', ({ correctAnswer, stats }) => {
        answerStatsDiv.innerHTML = '<h3>Thống kê đáp án</h3>';
        Object.keys(stats).forEach(opt => {
            const percent = Math.round(stats[opt] || 0);
            const row = document.createElement('div');
            row.className = 'stats-row' + (opt === correctAnswer ? ' correct' : '');
            const label = document.createElement('div'); label.innerText = opt;
            const bar = document.createElement('div'); bar.className = 'stats-bar';
            const fill = document.createElement('div'); fill.className = 'stats-fill';
            setTimeout(() => { fill.style.width = percent + '%'; }, 100);
            bar.appendChild(fill);
            const pct = document.createElement('div'); pct.innerText = percent + '%';
            row.appendChild(label); row.appendChild(bar); row.appendChild(pct);
            answerStatsDiv.appendChild(row);
        });
        
        if (window.__pendingAnswerResult) {
            const d = window.__pendingAnswerResult;
            if (d.isCorrect) { playSound('correct'); resultText.innerText = 'ĐÚNG'; resultText.className = 'correct'; }
            else { playSound('incorrect'); resultText.innerText = 'SAI'; resultText.className = 'incorrect'; }
            playerScore.innerText = `Điểm của bạn: ${d.score}`;
        }
    });
    socket.on('show_leaderboard', (data) => { 
        document.getElementById('leaderboardCongrats').style.display = data.players.length > 0 ? 'block' : 'none';
        leaderboardTableBody.innerHTML = '';
        data.players.forEach((player, index) => {
            const row = leaderboardTableBody.insertRow();
            const rank = index + 1;
            const rankCell = row.insertCell(0); rankCell.innerText = rank;
            const nameCell = row.insertCell(1); nameCell.innerText = player.nickname;
            row.insertCell(2).innerText = player.score;
            if (rank === 1) row.classList.add('rank-1');
            if (rank === 2) row.classList.add('rank-2');
            if (rank === 3) row.classList.add('rank-3');
        });
        if (isHost) { nextQuestionBtn.style.display = 'block'; }
        showScreen('leaderboard');
    });
    function fireConfetti() {
        confettiInstance({ particleCount: 150, spread: 180, origin: { y: 0.6 } });
        playSound('applause');
    }
    
    socket.on('game_over', (data) => {
        podiumOl.innerHTML = '';
        data.players.slice(0, 3).forEach(player => {
            const li = document.createElement('li');
            li.innerText = `${player.nickname} - ${player.score} điểm`;
            podiumOl.appendChild(li);
        });
        showScreen('gameOver');
        fireConfetti(); setTimeout(fireConfetti, 600);
    });
}); // DOMContentLoaded