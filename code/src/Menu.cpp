#include "../include/Menu.hpp"
#include "../include/Log.hpp"

Menu::Menu()
{
    console = nullptr;
    menuStack.push_back(this);

    selectionId = 0;
    finished = false;
}

Menu::~Menu()
{
    cleanup();
}

void Menu::addItem(const std::string& label)
{
    MenuItem item = {label, true, nullptr};
    menuStack.back()->pushItem(item);
}

void Menu::addItems(const std::vector<std::string> labels)
{
    for (const std::string& label : labels)
    {
        menuStack.back()->addItem(label);
    }
}

void Menu::addLabel(const std::string& label)
{
    menuStack.back()->pushItem({label, false, nullptr});
}

void Menu::addMenu(const std::string& label)
{
    MenuItem item = {label, true, new Menu};
    menuStack.back()->pushItem(item);
    menuStack.push_back(item.menu);
}

void Menu::endMenu()
{
    menuStack.pop_back();
}

void Menu::finalize()
{
    pAssert(menuStack.size() == 1, "Menu setup imbalanced.");

    int width = this->getLongest();
    int height = items.size();
    console = new TCODConsole(width, height);
    finished = true;

    // Finish submenus
    for (const MenuItem& item : items)
    {
        if (item.menu != nullptr)
            item.menu->finalize();
    }
}

void Menu::draw(int x, int y) const
{
    printf("Drawin'\n");
    int xlocation = x;
    int ylocation = y;
    for (const Menu* menu : menuStack)
    {
        menu->drawInternal(xlocation, ylocation);
        xlocation += 10;
        ylocation += 10;
    }
}

void Menu::update()
{
}

void Menu::drawInternal(int x, int y) const
{
    for (int i = 0; i < (signed)items.size(); ++i)
    {
        if (i == selectionId)
        {
            TCODConsole::setColorControl(TCOD_COLCTRL_1,TCODColor::red,TCODColor::black);
            console->print(0, i, "%c%s%c",
                           TCOD_COLCTRL_1, items[i].label.c_str(), TCOD_COLCTRL_STOP);
        }
        else
        {
            console->print(0, i, items[i].label.c_str());
        }
    }
    TCODConsole::blit(console, 0, 0, 0, 0, TCODConsole::root, x, y);
}

void Menu::handleInput(TCOD_key_t key)
{
    printf("Handlin'\n");
    menuStack.back()->handleInputInternal(key);
}

void Menu::handleInputInternal(TCOD_key_t key)
{
    if (key.vk == TCODK_UP)
    {
        selectionId -= 1;
        if (selectionId < 0)
            selectionId = (signed)items.size() - 1;
    }
    else if (key.vk == TCODK_DOWN)
    {
        selectionId += 1;
        if (selectionId > (signed)items.size() - 1)
            selectionId = 0;
    }
    else if (key.vk == TCODK_ENTER)
    {
        menuStack.push_back(items[selectionId].menu);
    }
    else if (key.vk == TCODK_BACKSPACE)
    {
        menuStack.pop_back();
    }
}

void Menu::cleanup()
{
    // Clean submenus
    for (const MenuItem& item : items)
    {
        if (item.menu != nullptr)
        {
            item.menu->cleanup();
            delete item.menu;
        }
    }

    delete console;
}

void Menu::pushItem(const MenuItem& item)
{
    items.push_back(item);
}

const int Menu::getLongest() const
{
    unsigned int max = 0;
    for (const MenuItem& item : items)
    {
        if (max < item.label.size())
            max = item.label.size();
    }

    return max;
}
