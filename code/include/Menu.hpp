#ifndef _Menu_hpp_
#define _Menu_hpp_

#include <string>
#include <vector>
#include <memory>

#include <libtcod.hpp>

class MenuAction
{
    public:
    enum ActionType
    {
        None,
        Select,
        Cancel,
        Left,
        Right
    };

    ActionType type;
    int menuItemId;

    MenuAction() 
    {
        clear();
    }

    void clear()        { type = None;   menuItemId = -1; }
    void select(int id) { type = Select; menuItemId = id; }
    void cancel()       { type = Cancel; }
    void left(int id)   { type = Left;   menuItemId = id; }
    void right(int id)  { type = Right;  menuItemId = id; }
};

class Menu
{
    public:
    Menu(std::vector<std::string> itemlist);
    ~Menu();

    // Core Menu methods.
    void draw(int x, int y) const;
    void update();
    void handleInput(TCOD_key_t key);

    const bool isActionTaken();
    const MenuAction& getAction();

    private:
    const int getLongest() const;

    private:
    std::unique_ptr<TCODConsole> console;
    std::vector<std::string> items;
    int selectionId;

    MenuAction action;
};

#endif // _Menu_hpp_

