#include "../include/Menu.hpp"

Menu::Menu(std::vector<std::string> list)
{
    selection = 0;
    items = list;

    int width = this->getLongest();
    int height = items.size();
    console = new TCODConsole(width, height);
}

Menu::~Menu()
{
    delete console;
}

void Menu::draw()
{
    for (int i = 0; i < (signed)items.size(); ++i)
    {
        if (i == selection)
        {
            TCODConsole::setColorControl(TCOD_COLCTRL_1,TCODColor::red,TCODColor::black);
            console->print(0, i, "%c%s%c",
                           TCOD_COLCTRL_1, items[i].c_str(), TCOD_COLCTRL_STOP);
        }
        else
        {
            console->print(0, i, items[i].c_str());
        }
    }
    TCODConsole::blit(console, 0, 0, 0, 0, TCODConsole::root, 20, 20);
}

bool Menu::update()
{
    return false;
}

bool Menu::handleInput(TCOD_key_t key)
{
    if (key.vk == TCODK_UP)
    {
        selection -= 1;
        if (selection < 0)
            selection = (signed)items.size() - 1;
    }
    else if (key.vk == TCODK_DOWN)
    {
        selection += 1;
        if (selection > (signed)items.size() - 1)
            selection = 0;
    }

    return false;
}

const int Menu::getLongest() const
{
    unsigned int max = 0;
    for (const std::string& str : items)
    {
        if (max < str.size())
            max = str.size();
    }

    return max;
}
