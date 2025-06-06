// Инициализация PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// Функция для преобразования строки с числом в float
function parseAmount(amountStr) {
    amountStr = amountStr.trim();
    console.log('Парсинг суммы:', amountStr);
    
    // Если число в формате "30,000.00"
    if (/^\d+,\d{3}\.\d{2}$/.test(amountStr)) {
        return parseFloat(amountStr.replace(',', ''));
    }
    
    // Если число в формате "20.00"
    if (/^\d+\.\d{2}$/.test(amountStr)) {
        return parseFloat(amountStr);
    }
    
    // Если число в формате "20,00" или "30000,00"
    if (/^\d+,\d{2}$/.test(amountStr)) {
        return parseFloat(amountStr.replace(',', '.'));
    }
    
    // Если число без десятичной части
    if (/^\d+$/.test(amountStr)) {
        return parseFloat(amountStr);
    }
    
    throw new Error(`Неизвестный формат числа: ${amountStr}`);
}

// Функция для преобразования строки с датой в объект Date
function parseDate(dateStr) {
    console.log('Парсинг даты:', dateStr);
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
    return date.toISOString().split('T')[0];
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

// Функция для извлечения транзакций из PDF
async function extractTransactionsFromPdf(pdfFile) {
    console.log('Начинаем обработку PDF файла...');
    const arrayBuffer = await pdfFile.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const transactions = [];

    console.log('Количество страниц в PDF:', pdf.numPages);

    for (let i = 1; i <= pdf.numPages; i++) {
        console.log(`Обработка страницы ${i}...`);
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        
        // Получаем все текстовые элементы с их позициями
        const textItems = textContent.items.map(item => ({
            text: item.str,
            x: item.transform[4],
            y: item.transform[5]
        }));

        // Сортируем элементы по y-координате (сверху вниз)
        textItems.sort((a, b) => b.y - a.y);

        // Группируем элементы в строки
        const lines = [];
        let currentLine = [];
        let currentY = null;
        const yThreshold = 5; // Порог для определения одной строки

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

        console.log('Строки на странице:', lines.length);
        console.log('Первые 10 строк:', lines.slice(0, 10));

        for (let j = 0; j < lines.length; j++) {
            const line = lines[j].trim();
            
            // Обработка Nalog транзакций
            const nalogMatch = line.match(/(\d+\.)\s+(\d{2}\.\d{2}\.\d{2,4})\s+Nalog:/);
            if (nalogMatch) {
                console.log('Найдена Nalog транзакция:', line);
                try {
                    const date = parseDate(nalogMatch[2]);
                    // Ищем сумму в строке или в следующих строках
                    let amount = null;
                    let payee = '';
                    
                    // Сначала проверяем текущую строку
                    const amountMatch = line.match(/(\d+[.,]\d{2})\s+(\d+[.,]\d{2})/);
                    if (amountMatch) {
                        amount = parseAmount(amountMatch[1]);
                        console.log('Сумма найдена в текущей строке:', amount);
                    }
                    
                    // Получаем описание из следующих строк
                    for (let k = 1; k <= 3; k++) {
                        if (j + k < lines.length) {
                            const nextLine = lines[j + k].trim();
                            if (!/^\d+\.\s+\d{2}\.\d{2}\.\d{2,4}/.test(nextLine)) {
                                payee += nextLine + ' ';
                                // Проверяем, есть ли сумма в этой строке
                                const nextAmountMatch = nextLine.match(/(\d+[.,]\d{2})\s+(\d+[.,]\d{2})/);
                                if (nextAmountMatch && amount === null) {
                                    amount = parseAmount(nextAmountMatch[1]);
                                    console.log('Сумма найдена в следующей строке:', amount);
                                }
                            }
                        }
                    }
                    payee = payee.trim();
                    console.log('Описание транзакции:', payee);

                    if (amount !== null) {
                        transactions.push({
                            Date: formatDate(date),
                            Payee: payee,
                            Category: '',
                            Memo: '',
                            Outflow: payee.toLowerCase().includes('uplata') ? '' : amount.toFixed(2).replace('.', ','),
                            Inflow: payee.toLowerCase().includes('uplata') ? amount.toFixed(2).replace('.', ',') : ''
                        });
                        console.log('Транзакция добавлена:', transactions[transactions.length - 1]);
                    }
                } catch (e) {
                    console.error('Ошибка при обработке Nalog:', line, e);
                }
                continue;
            }

            // Обработка Kartica транзакций
            const karticaMatch = line.match(/(\d+\.)\s+(\d{2}\.\d{2}\.\d{4})\s+Kartica\s*:/);
            if (karticaMatch) {
                console.log('Найдена Kartica транзакция:', line);
                try {
                    const date = parseDate(karticaMatch[2]);
                    let payee = '';
                    let amount = null;

                    // Получаем название магазина из следующей строки
                    if (j + 1 < lines.length) {
                        payee = lines[j + 1].trim();
                        console.log('Название магазина:', payee);
                    }

                    // Ищем сумму в строке с "Iznos transakcije"
                    for (let k = 1; k <= 5; k++) {
                        if (j + k < lines.length) {
                            const nextLine = lines[j + k].trim();
                            const amountMatch = nextLine.match(/Iznos transakcije:\s*([\d\.,]+)/);
                            if (amountMatch) {
                                amount = parseAmount(amountMatch[1]);
                                console.log('Найдена сумма в Iznos transakcije:', amount);
                                break;
                            }
                        }
                    }

                    if (amount !== null) {
                        transactions.push({
                            Date: formatDate(date),
                            Payee: payee,
                            Category: '',
                            Memo: '',
                            Outflow: amount.toFixed(2).replace('.', ','),
                            Inflow: ''
                        });
                        console.log('Транзакция добавлена:', transactions[transactions.length - 1]);
                    }
                } catch (e) {
                    console.error('Ошибка при обработке Kartica:', line, e);
                }
            }
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
    tbody.innerHTML = '';

    // Отображаем количество транзакций
    countElement.textContent = `${transactions.length} transactions`;

    // Показываем элементы управления
    document.querySelector('.date-filter').classList.remove('hidden');
    document.getElementById('transactions-count').classList.remove('hidden');
    document.getElementById('downloadCsv').classList.remove('hidden');

    // Если есть транзакции, показываем таблицу
    if (transactions.length > 0) {
        document.querySelector('.table-container').classList.remove('hidden');
    } else {
        document.querySelector('.table-container').classList.add('hidden');
    }

    transactions.forEach(transaction => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${transaction.Date}</td>
            <td>${transaction.Payee}</td>
            <td>${transaction.Outflow}</td>
            <td>${transaction.Inflow}</td>
        `;
        tbody.appendChild(row);
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