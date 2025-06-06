// Инициализация PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// Функция для преобразования строки с числом в float (адаптировано из Python)
function parseAmount(amountStr) {
    if (!amountStr) return null;
    
    amountStr = amountStr.trim();
    
    // Если число в формате "30,000.00" (запятая как разделитель тысяч, точка как десятичный разделитель)
    if (/^\d+,\d{3}\.\d{2}$/.test(amountStr)) {
        return parseFloat(amountStr.replace(',', ''));
    }
    
    // Если число в формате "20.00" (точка как десятичный разделитель)
    if (/^\d+\.\d{2}$/.test(amountStr)) {
        return parseFloat(amountStr);
    }
    
    // Если число в формате "20,00" (запятая как десятичный разделитель)
    if (/^\d+,\d{2}$/.test(amountStr)) {
        return parseFloat(amountStr.replace(',', '.'));
    }
    
    // Если число без десятичной части
    if (/^\d+$/.test(amountStr)) {
        return parseFloat(amountStr);
    }
    
    // Общий случай: удаляем пробелы и заменяем запятую на точку
    return parseFloat(amountStr.replace(/\s/g, '').replace(',', '.'));
}

// Функция для преобразования строки с датой в объект Date
function parseDate(dateStr) {
    console.log('Парсинг даты:', dateStr);
    // дд.мм.гг или дд.мм.гггг
    if (/^\d{2}\.\d{2}\.\d{2}$/.test(dateStr)) {
        const [day, month, year] = dateStr.split('.');
        return new Date(2000 + parseInt(year), parseInt(month) - 1, parseInt(day));
    } else {
        const [day, month, year] = dateStr.split('.');
        return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    }
}

// Функция для форматирования даты в YYYY-MM-DD
function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatAmount(amount) {
    if (amount === null || amount === undefined || amount === '') return '';
    // Форматируем число с двумя знаками после запятой
    return parseFloat(amount).toFixed(2).replace('.', ',');
}

let allTransactions = []; // Глобальная переменная для хранения всех транзакций

// Функция для фильтрации транзакций по датам
function filterTransactionsByDate(transactions, startDate, endDate) {
    if (!startDate && !endDate) return transactions;
    
    return transactions.filter(transaction => {
        const transactionDate = new Date(transaction.Date);
        if (startDate && endDate) {
            return transactionDate >= startDate && transactionDate <= endDate;
        } else if (startDate) {
            return transactionDate >= startDate;
        } else if (endDate) {
            return transactionDate <= endDate;
        }
        return true;
    });
}

// Функция для извлечения транзакций из PDF (адаптировано из Python логики)
async function extractTransactionsFromPdf(pdfFile) {
    console.log('Начинаем обработку PDF файла...');
    const arrayBuffer = await pdfFile.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const transactions = [];

    console.log('Количество страниц в PDF:', pdf.numPages);

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        console.log(`Обработка страницы ${pageNum}...`);
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        
        // Извлекаем текст как в Python скрипте - строка за строкой
        const lines = [];
        const textItems = textContent.items.map(item => ({
            text: item.str,
            x: item.transform[4],
            y: item.transform[5]
        }));

        // Сортируем по Y координате (сверху вниз)
        textItems.sort((a, b) => b.y - a.y);

        // Группируем в строки
        let currentLine = [];
        let currentY = null;
        const yThreshold = 5;

        textItems.forEach(item => {
            if (currentY === null) {
                currentY = item.y;
            }

            if (Math.abs(item.y - currentY) <= yThreshold) {
                currentLine.push(item.text);
            } else {
                if (currentLine.length > 0) {
                    lines.push(currentLine.join(' '));
                }
                currentLine = [item.text];
                currentY = item.y;
            }
        });

        if (currentLine.length > 0) {
            lines.push(currentLine.join(' '));
        }

        console.log(`Страница ${pageNum}: найдено ${lines.length} строк`);

        // ОТЛАДКА: Выводим все строки для анализа паттернов
        console.log(`=== ОТЛАДКА СТРАНИЦЫ ${pageNum} ===`);
        lines.forEach((line, index) => {
            // Ищем строки с номерами транзакций
            if (/\d+\.\s+\d{2}\.\d{2}\.\d{2,4}/.test(line) || /Nalog|Kartica/.test(line)) {
                console.log(`Строка ${index}: "${line}"`);
            }
        });
        console.log('=== КОНЕЦ ОТЛАДКИ ===');

        // Обрабатываем строки как в Python скрипте
        let i = 0;
        while (i < lines.length) {
            const line = lines[i].trim();
            
            // Ищем Nalog транзакции: [баланс] [сумма] номер. дата Nalog: ...
            const nalogMatch = line.match(/^([\d\.,]+)\s+([\d\.,]+)\s+(\d+)\.\s+(\d{2}\.\d{2}\.\d{2,4})\s+Nalog:\s*(.*)$/);
            if (nalogMatch) {
                console.log(`Найдена Nalog транзакция: ${line}`);
                try {
                    const [, balance, amount, transactionNumber, dateStr, operation] = nalogMatch;
                    const date = parseDate(dateStr);
                    const transactionAmount = parseAmount(amount);
                    
                    // Описание — 1-2 строки после, если не начинается с номера новой транзакции
                    let payee = '';
                    const descLines = [];
                    for (let j = 1; j <= 3; j++) {
                        if (i + j < lines.length) {
                            const nextLine = lines[i + j].trim();
                            if (!/^[\d\.,]+\s+[\d\.,]+\s+\d+\.\s+\d{2}\.\d{2}\.\d{2,4}/.test(nextLine) &&
                                !nextLine.includes('Poziv za reklamaciju') &&
                                !nextLine.includes('Datum prijema') &&
                                nextLine.length > 0) {
                                descLines.push(nextLine);
                            }
                        }
                    }
                    payee = descLines.join(' ').trim();
                    
                    // Определяем Inflow/Outflow
                    let inflow = '';
                    let outflow = '';
                    if (payee.toLowerCase().includes('uplata')) {
                        inflow = formatAmount(transactionAmount);
                    } else {
                        outflow = formatAmount(transactionAmount);
                    }
                    
                    transactions.push({
                        Date: formatDate(date),
                        Payee: payee || 'Банковский перевод',
                        Category: '',
                        Memo: '',
                        Outflow: outflow,
                        Inflow: inflow
                    });
                    console.log(`Добавлена Nalog транзакция: ${payee} - ${transactionAmount}`);
                    
                } catch (error) {
                    console.error(`Ошибка при обработке Nalog: ${line}`, error);
                }
                i++;
                continue;
            }
            
            // Ищем Kartica транзакции: [баланс] [сумма] номер. дата Kartica : ...
            const karticaMatch = line.match(/^([\d\.,]+)\s+([\d\.,]+)\s+(\d+)\.\s+(\d{2}\.\d{2}\.\d{4})\s+Kartica\s*:\s*(.*)$/);
            if (karticaMatch) {
                console.log(`Найдена Kartica транзакция: ${line}`);
                try {
                    const [, balance, amount, transactionNumber, dateStr, cardInfo] = karticaMatch;
                    const date = parseDate(dateStr);
                    const transactionAmount = parseAmount(amount);
                    let payee = '';
                    
                    // Следующая строка — название магазина
                    if (i + 1 < lines.length) {
                        const nextLine = lines[i + 1].trim();
                        if (!nextLine.includes('Poziv za reklamaciju') && 
                            !nextLine.includes('Datum prijema') &&
                            !/^[\d\.,]+\s+[\d\.,]+\s+\d+\.\s+\d{2}\.\d{2}\.\d{4}/.test(nextLine)) {
                            payee = nextLine;
                        }
                    }
                    
                    transactions.push({
                        Date: formatDate(date),
                        Payee: payee || 'Операция по карте',
                        Category: '',
                        Memo: '',
                        Outflow: formatAmount(transactionAmount),
                        Inflow: ''
                    });
                    console.log(`Добавлена Kartica транзакция: ${payee} - ${transactionAmount}`);
                    
                } catch (error) {
                    console.error(`Ошибка при обработке Kartica: ${line}`, error);
                }
                i++;
                continue;
            }
            
            i++;
        }
    }
    
    console.log('Всего найдено транзакций:', transactions.length);
    return transactions;
}

// Функция для отображения транзакций в таблице
function displayTransactions(transactions) {
    console.log('Отображение транзакций в таблице:', transactions);
    const tbody = document.querySelector('#transactions-table tbody');
    const countElement = document.getElementById('transactions-count');
    const tableContainer = document.querySelector('.table-container');
    tbody.innerHTML = '';

    // Отображаем количество транзакций
    countElement.textContent = `${transactions.length} transactions`;

    // Показываем элементы управления
    document.querySelector('.date-filter').classList.remove('hidden');
    document.getElementById('transactions-count').classList.remove('hidden');
    document.getElementById('downloadCsv').classList.remove('hidden');

    // Если есть транзакции, показываем таблицу с анимацией
    if (transactions.length > 0) {
        // Если таблица скрыта, показываем её с анимацией
        if (tableContainer.classList.contains('hidden')) {
            tableContainer.classList.remove('hidden');
            
            // Анимация появления
            tableContainer.animate([
                {
                    opacity: 0,
                    transform: 'translateY(32px)'
                },
                {
                    opacity: 1,
                    transform: 'translateY(0)'
                }
            ], {
                duration: 133,
                delay: 0,
                easing: 'ease-in-out',
                fill: 'forwards'
            });
        }
    } else {
        // Анимация скрытия перед добавлением класса hidden
        if (!tableContainer.classList.contains('hidden')) {
            tableContainer.animate([
                {
                    opacity: 1,
                    transform: 'translateY(0) scale(1)',
                    filter: 'blur(0px)'
                },
                {
                    opacity: 0,
                    transform: 'translateY(-20px) scale(0.95)',
                    filter: 'blur(3px)'
                }
            ], {
                duration: 400,
                easing: 'cubic-bezier(0.55, 0.085, 0.68, 0.53)',
                fill: 'forwards'
            }).finished.then(() => {
                tableContainer.classList.add('hidden');
            });
        }
    }

    // Добавляем строки в таблицу
    transactions.forEach((transaction, index) => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${transaction.Date}</td>
            <td>${transaction.Payee}</td>
            <td class="amount-column">${transaction.Outflow}</td>
            <td class="amount-column">${transaction.Inflow}</td>
        `;
        tbody.appendChild(row);
        
        // Анимация появления строк с небольшой задержкой
            // if (transactions.length > 0) {
            //     row.animate([
            //         {
            //             opacity: 0,
            //             transform: 'translateY(16px)'
            //         },
            //         {
            //             opacity: 1,
            //             transform: 'translateX(0)'
            //         }
            //     ], {
            //         duration: 300,
            //         delay: index * 100, // Задержка для каждой строки
            //         easing: 'ease-in-out',
            //         fill: 'forwards'
            //     });
            // }
    });
}

// Обновленная функция для создания и скачивания CSV
function downloadCsv(transactions) {
    const startDate = document.getElementById('startDate').value;
    const endDate = document.getElementById('endDate').value;
    
    const filteredTransactions = filterTransactionsByDate(
        transactions,
        startDate ? new Date(startDate) : null,
        endDate ? new Date(endDate) : null
    );
    
    console.log('Создание CSV файла из отфильтрованных транзакций:', filteredTransactions);
    const csv = Papa.unparse(filteredTransactions);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', 'ynab_import.csv');
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Функция для определения крайних дат в транзакциях
function getDateRange(transactions) {
    if (!transactions || transactions.length === 0) return null;
    
    let minDate = new Date(transactions[0].Date);
    let maxDate = new Date(transactions[0].Date);
    
    transactions.forEach(transaction => {
        const date = new Date(transaction.Date);
        if (date < minDate) minDate = date;
        if (date > maxDate) maxDate = date;
    });
    
    return {
        minDate: minDate.toISOString().split('T')[0],
        maxDate: maxDate.toISOString().split('T')[0]
    };
}

// Функция для установки значений дат в фильтре
function setDateFilterValues(minDate, maxDate) {
    const startDateInput = document.getElementById('startDate');
    const endDateInput = document.getElementById('endDate');
    
    startDateInput.value = minDate;
    endDateInput.value = maxDate;
}

// Функция для применения фильтра
function applyDateFilter() {
    const startDate = document.getElementById('startDate').value;
    const endDate = document.getElementById('endDate').value;
    
    const filteredTransactions = filterTransactionsByDate(
        allTransactions,
        startDate ? new Date(startDate) : null,
        endDate ? new Date(endDate) : null
    );
    
    displayTransactions(filteredTransactions);
}

// Обновляем обработчик загрузки файла
document.getElementById('pdfFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) {
        try {
            allTransactions = await extractTransactionsFromPdf(file);
            document.getElementById('preview-section').classList.remove('hidden');
            
            // Устанавливаем крайние даты в фильтр
            const dateRange = getDateRange(allTransactions);
            if (dateRange) {
                setDateFilterValues(dateRange.minDate, dateRange.maxDate);
            }
            
            displayTransactions(allTransactions);
        } catch (error) {
            console.error('Ошибка при обработке PDF:', error);
            alert('Произошла ошибка при обработке PDF файла');
        }
    }
});

// Добавляем обработчики изменения дат
document.getElementById('startDate').addEventListener('change', applyDateFilter);
document.getElementById('endDate').addEventListener('change', applyDateFilter);

// Обновляем обработчик для кнопки скачивания CSV
document.getElementById('downloadCsv').addEventListener('click', () => {
    downloadCsv(allTransactions);
});

// Можно добавить анимацию загрузки
function showLoadingAnimation(tableContainer) {
    return tableContainer.animate([
        { opacity: 0.5, transform: 'scale(0.98)' },
        { opacity: 0.7, transform: 'scale(1.01)' },
        { opacity: 0.5, transform: 'scale(0.98)' }
    ], {
        duration: 1000,
        iterations: Infinity,
        direction: 'alternate'
    });
}

// Остановить анимацию загрузки
function stopLoadingAnimation(animation) {
    if (animation) {
        animation.cancel();
    }
}