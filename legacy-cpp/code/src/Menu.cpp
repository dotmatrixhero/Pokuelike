#include "../include/Menu.hpp"
#include "../include/Log.hpp"

#include "../include/memutils.hpp"

Menu::Menu(std::vector<std::string> itemlist)
{
    items = itemlist;
    selectionId = 0;

    int height = items.size();
    int width  = this->getLongest();
    console = make_unique<TCODConsole>(width, height);
}

Menu::~Menu()
{
}

void Menu::draw(int x, int y) const
{
    for (int i = 0; i < (signed)items.size(); ++i)
    {
        if (i == selectionId)
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
    TCODConsole::blit(console.get(), 0, 0, 0, 0, TCODConsole::root, x, y);
}

void Menu::update()
{
}

void Menu::handleInput(TCOD_key_t key)
{
    action.clear();

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
    else if (key.vk == TCODK_LEFT)
    {
        action.left(selectionId);
    }
    else if (key.vk == TCODK_RIGHT)
    {
        action.right(selectionId);
    }
    else if (key.vk == TCODK_ENTER)
    {
        action.select(selectionId);
    }
    else if (key.vk == TCODK_BACKSPACE)
    {
        action.cancel();
    }
}

const bool Menu::isActionTaken()
{ 
    return (getAction().type != MenuAction::None); 
}

const MenuAction& Menu::getAction()
{ 
    return action;
}

const int Menu::getLongest() const
{
    unsigned int max = 0;
    for (const std::string& item : items)
    {
        if (max < item.size())
            max = item.size();
    }

    return max;
}

